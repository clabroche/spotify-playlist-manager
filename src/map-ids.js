/**
 * Remplace les identifiants Spotify de playlists.json par ceux de Deezer, en
 * rapprochant les titres (le préfixe « NN ~ » posé par ce même outil est
 * ignoré). Affiche le rapprochement et n'écrit qu'avec --write.
 */
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { playlists: remotePlaylists } = require('./deezer')

const confPath = path.resolve(__dirname, 'assets', 'playlists.json')
const write = process.argv.includes('--write')

const loose = v => (v || '').toLowerCase().replace(/^\d+\s*~\s*/, '').replace(/[^a-z0-9]+/g, '')

;(async () => {
  const remote = await remotePlaylists()
  const conf = JSON.parse(fs.readFileSync(confPath, 'utf-8'))
  let missing = 0
  for (const version of conf.versions) {
    const match = remote.find(r => loose(r.title) === loose(version.playlistTitle))
    if (!match) {
      missing++
      console.log(`✗ ${version.playlistTitle.padEnd(16)} aucune playlist Deezer correspondante`)
      continue
    }
    console.log(`✓ ${version.playlistTitle.padEnd(16)} ${match.id}  « ${match.title} »`)
    version.playlistId = match.id
  }
  if (write) {
    fs.writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n')
    console.log(`\nplaylists.json mis à jour (${conf.versions.length - missing} identifiants).`)
  } else {
    console.log('\nRien écrit — relance avec --write pour enregistrer.')
  }
})().catch(err => { console.error(err.message); process.exit(1) })
