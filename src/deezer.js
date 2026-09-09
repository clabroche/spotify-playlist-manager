/**
 * Dos Deezer, en remplacement de src/spotify.js.
 *
 * Deezer ne délivre plus d'applications OAuth : on s'authentifie donc avec
 * l'ARL (cookie de session du compte), échangé contre un JWT court — le même
 * mécanisme que l'app ipodapp utilise pour les paroles.
 *
 * Poser une pochette se fait en deux temps, comme sur le site : l'image part
 * vers upload.deezer.com, qui renvoie un jeton, et ce jeton est passé à la
 * mutation updatePlaylist. Envoyer l'image en base64 directement est rejeté.
 */
const axios = require('axios').default

const AUTH_URL = 'https://auth.deezer.com/login/arl?jo=p&rto=p&i=c'
const PIPE_URL = 'https://pipe.deezer.com/api'
const UPLOAD_URL = 'https://upload.deezer.com/v2/playlist/picture'
const ORIGIN = 'https://www.deezer.com'

let jwt = ''
let jwtExp = 0

function arl() {
  const v = (process.env.DEEZER_ARL || '').trim()
  if (!v) throw new Error('DEEZER_ARL manquant — « source ~/.deezer » d\'abord.')
  return v
}

async function token() {
  if (jwt && Date.now() < jwtExp) return jwt
  const { data } = await axios.post(AUTH_URL, {}, {
    headers: { Cookie: 'arl=' + arl(), 'Content-Type': 'application/json' },
  })
  if (!data || !data.jwt) throw new Error('ARL refusé par Deezer')
  jwt = data.jwt
  // Le jeton vit quelques minutes : on le renouvelle largement avant la fin.
  jwtExp = Date.now() + 4 * 60 * 1000
  return jwt
}

async function pipe(query, variables) {
  const { data } = await axios.post(PIPE_URL, { query, variables }, {
    headers: { Authorization: 'Bearer ' + (await token()), Origin: ORIGIN },
  })
  if (data.errors && data.errors.length) {
    throw new Error('Deezer : ' + JSON.stringify(data.errors[0].message || data.errors[0]))
  }
  return data.data
}

const Q_PLAYLISTS = `query MyPlaylists($first: Int!) {
  me { playlists(first: $first) { edges { node { id title } } } }
}`

const Q_UPDATE = `mutation UpdatePlaylist($input: PlaylistUpdateMutationInput!) {
  updatePlaylist(input: $input) { playlist { id title } }
}`

module.exports = {
  /** Playlists du compte : [{ id, title }]. */
  async playlists() {
    const data = await pipe(Q_PLAYLISTS, { first: 100 })
    return (data.me.playlists.edges || []).map(e => e.node)
  },

  /** @param {string} playlistId @param {string} base64 JPEG sans en-tête data:. */
  async updateCover(playlistId, base64) {
    const buffer = Buffer.from(base64, 'base64')
    const boundary = '----cover' + Date.now().toString(16)
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; ` +
        `filename="cover.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const { data } = await axios.post(UPLOAD_URL, body, {
      headers: {
        Authorization: 'Bearer ' + (await token()),
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        Origin: ORIGIN,
      },
      maxBodyLength: Infinity,
    })
    const picture = data && data.results
    if (typeof picture !== 'string' || !picture) {
      throw new Error('Upload refusé : ' + JSON.stringify(data && data.error))
    }
    await pipe(Q_UPDATE, { input: { playlistId, picture } })
  },

  async updateInfos(playlistId, version, prefix = '') {
    await pipe(Q_UPDATE, {
      input: {
        playlistId,
        title: prefix + version.playlistTitle,
        description: version.description || '',
        isPrivate: version.public ? false : true,
      },
    })
  },
}
