#!/usr/bin/env python3
"""Pochettes de playlists Deezer, en ligne de commande, avec l'ARL.

Deux étapes, comme le fait le site : l'image est d'abord envoyée à
`upload.deezer.com/v2/playlist/picture`, qui renvoie un jeton, puis ce jeton
est posé sur la playlist par la mutation `updatePlaylist`. Les deux
s'authentifient avec le JWT tiré de l'ARL — le même que l'app utilise pour
les paroles. Pas d'OAuth : Deezer ne délivre plus d'applications.

    source ~/.deezer
    tools/deezer-cover.py list
    tools/deezer-cover.py set 13979554581 pochette.jpg
    tools/deezer-cover.py reset 13979554581

`~/.deezer` doit exporter l'ARL (Deezer web → cookie `arl`) :

    export DEEZER_ARL=...

L'ARL vaut un accès complet au compte : garde le fichier en 600.
"""
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

AUTH_URL = 'https://auth.deezer.com/login/arl?jo=p&rto=p&i=c'
PIPE_URL = 'https://pipe.deezer.com/api'
UPLOAD_URL = 'https://upload.deezer.com/v2/playlist/picture'
ORIGIN = 'https://www.deezer.com'

# Deezer sert la pochette jusqu'en 1000 px : en dessous, ça se voit.
MIN_SIDE = 500


def die(msg):
    print(msg, file=sys.stderr)
    raise SystemExit(1)


def http(url, data=None, headers=None, method=None):
    req = urllib.request.Request(url, data=data, method=method,
                                 headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        die('HTTP %d sur %s : %s' % (e.code, url, e.read()[:200].decode('utf-8', 'replace')))


def arl():
    v = os.environ.get('DEEZER_ARL', '').strip()
    if not v:
        die("DEEZER_ARL manquant — « source ~/.deezer » d'abord.")
    return v


_jwt = {'token': '', 'exp': 0}


def jwt():
    """JWT court tiré de l'ARL, regénéré quand il approche de l'expiration."""
    if _jwt['token'] and time.time() < _jwt['exp'] - 30:
        return _jwt['token']
    body = http(AUTH_URL, data=b'{}', method='POST', headers={
        'Cookie': 'arl=' + arl(),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    })
    token = json.loads(body).get('jwt', '')
    if not token:
        die('ARL refusé par Deezer : ' + body[:200])
    _jwt['token'] = token
    # Sans lecture du payload, on se contente d'une durée prudente.
    _jwt['exp'] = time.time() + 240
    return token


def pipe(query, variables):
    body = http(PIPE_URL, method='POST', headers={
        'Authorization': 'Bearer ' + jwt(),
        'Content-Type': 'application/json',
        'Origin': ORIGIN,
    }, data=json.dumps({'query': query, 'variables': variables}).encode())
    data = json.loads(body)
    if data.get('errors'):
        die('Deezer : ' + json.dumps(data['errors'][0].get('message', data['errors'])))
    return data.get('data') or {}


# --- commandes -----------------------------------------------------------

Q_LIST = """query MyPlaylists($first: Int!) {
  me { playlists(first: $first) { edges { node {
    id title estimatedTracksCount
  } } } }
}"""

Q_SET = """mutation UpdatePlaylist($input: PlaylistUpdateMutationInput!) {
  updatePlaylist(input: $input) { playlist {
    id title picture { urls(pictureRequest: { width: 500, height: 500 }) }
  } }
}"""

# Le résultat est une union : sans fragments, Deezer répond « Error » tout court.
Q_RESET = """mutation ResetCover($input: ResetDefaultPlaylistCoverInput!) {
  resetDefaultPlaylistCover(input: $input) {
    __typename
    ... on ResetDefaultPlaylistCoverMutationOutput {
      playlist { id picture { urls(pictureRequest: { width: 500, height: 500 }) } }
    }
    ... on ResetDefaultPlaylistCoverMutationError {
      playlistNotFound userIsNotPlaylistOwner isLovedTracksPlaylist
    }
  }
}"""


def cmd_list(args):
    if args:
        die('usage : deezer-cover.py list')
    data = pipe(Q_LIST, {'first': 100})
    edges = (((data.get('me') or {}).get('playlists') or {}).get('edges')) or []
    for e in edges:
        n = e.get('node') or {}
        print('%-14s %4d titres  %s' % (n.get('id', ''), n.get('estimatedTracksCount') or 0,
                                        n.get('title', '')))


def check_image(path):
    if not os.path.isfile(path):
        die('Image introuvable : ' + path)
    try:
        from PIL import Image
    except ImportError:
        return
    with Image.open(path) as im:
        w, h = im.size
    if min(w, h) < MIN_SIDE:
        die('Image trop petite (%dx%d) : vise au moins %d px de côté.' % (w, h, MIN_SIDE))
    if abs(w - h) > max(w, h) * 0.02:
        print('Attention : image non carrée (%dx%d), Deezer va la rogner.' % (w, h))


def upload(path):
    """Envoie l'image et renvoie le jeton attendu par `picture`."""
    boundary = '----cover' + uuid.uuid4().hex
    name = os.path.basename(path)
    ctype = mimetypes.guess_type(name)[0] or 'image/jpeg'
    with open(path, 'rb') as f:
        content = f.read()
    body = (
        ('--%s\r\nContent-Disposition: form-data; name="file"; filename="%s"\r\n'
         'Content-Type: %s\r\n\r\n' % (boundary, name, ctype)).encode()
        + content + ('\r\n--%s--\r\n' % boundary).encode()
    )
    out = http(UPLOAD_URL, data=body, method='POST', headers={
        'Authorization': 'Bearer ' + jwt(),
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Origin': ORIGIN,
    })
    data = json.loads(out)
    err = data.get('error')
    if err and (not isinstance(err, list) or err):
        die('Upload refusé : ' + json.dumps(err))
    token = data.get('results')
    if not isinstance(token, str) or not token:
        die('Réponse d’upload inattendue : ' + out[:200])
    return token


def cmd_set(args):
    if len(args) != 2:
        die('usage : deezer-cover.py set <playlist_id> <image>')
    playlist_id, image = args
    check_image(image)
    data = pipe(Q_SET, {'input': {'playlistId': playlist_id, 'picture': upload(image)}})
    pl = (data.get('updatePlaylist') or {}).get('playlist') or {}
    urls = ((pl.get('picture') or {}).get('urls')) or ['']
    print('Pochette posée sur « %s » :\n  %s' % (pl.get('title', playlist_id), urls[0]))


def cmd_reset(args):
    if len(args) != 1:
        die('usage : deezer-cover.py reset <playlist_id>')
    res = pipe(Q_RESET, {'input': {'playlistId': args[0]}}).get('resetDefaultPlaylistCover') or {}
    if res.get('__typename') == 'ResetDefaultPlaylistCoverMutationError':
        reasons = [k for k, v in res.items() if v is True]
        die('Refus de Deezer : ' + (', '.join(reasons) or 'raison inconnue'))
    print('Pochette rendue à la mosaïque automatique.')


def main():
    cmds = {'list': cmd_list, 'set': cmd_set, 'reset': cmd_reset}
    if len(sys.argv) < 2 or sys.argv[1] not in cmds:
        print(__doc__)
        raise SystemExit(2)
    cmds[sys.argv[1]](sys.argv[2:])


if __name__ == '__main__':
    main()
