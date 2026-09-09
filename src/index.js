const fs = require('fs')
const path = require('path')
const chokidar = require('chokidar')
const PromiseB = require('bluebird')
require('dotenv').config()
const { getPage, screen, close: browserClose } = require('./browser')
// Dos Deezer : Spotify n'est plus la cible (cf. src/deezer.js). L'ancien
// src/spotify.js reste en place pour mémoire.
const { updateCover, updateInfos, playlists: remotePlaylists } = require('./deezer')
const { isPreviewMode, isEditable } = require('./cli')
const coverDir = path.resolve(__dirname, '..', 'output')

let playlists = getConf()

if (!fs.existsSync(coverDir)) fs.mkdirSync(coverDir)

  ; (async _ => {
    const isLogged = await checkAuth()
    console.log('Image generation...')

    if (isPreviewMode) await showPreviews()
    else await generateCovers()

    if (isLogged && !isPreviewMode) await updateDeezer()
  })().catch(async err => {
    console.error(err?.response?.data || err?.response?.status || err)
    await browserClose()
    process.exit(1)
  })

async function setStyle(page, version) {
  const backgroundImagePath = version.backgroundImage
    ? path.resolve(__dirname, 'assets', version.backgroundImage)
    : path.resolve(__dirname, 'assets', playlists.backgroundImage)
  let b64
  if (fs.existsSync(backgroundImagePath)) {
    const backgroundImage = fs.readFileSync(backgroundImagePath);
    b64 = 'data:image/png;base64,' + Buffer.from(backgroundImage).toString('base64');
  }
  await page.evaluate(({ version, b64 }) => {
    const root = document.querySelector('body')
    if (root === null) return
    if (b64) {
      const element = root.querySelector('.root')
      element.style.backgroundImage = `url(${b64})`
    }
    Object.keys(version.style).forEach(selector => {
      const style = version.style[selector]
      const element = /** @type {HTMLElement} */ (root.querySelector(selector))
      Object.keys(style).forEach(directive => {
        element.style[directive] = style[directive]
      })
    });
    root.querySelectorAll('[sp-text]').forEach(text => {
      text.textContent = version.text
    })
  }, { version, b64 })
}

function loadHtml() {
  let contentHtml = fs.readFileSync(path.resolve(__dirname, 'assets', 'index.html'), 'utf8');

  return contentHtml
}

function getPrefix(version, index) {
  return version.prefix
    ? version.prefix.replace('{{order}}', (index + 1).toString().padStart(2, '0'))
    : ''
}

async function generateCovers(playlistToGenerate) {
  if (!playlistToGenerate?.length) playlistToGenerate = playlists.versions.map(v => v.id)
  const page = await getPage('about:blank', { headless: !isEditable })
  await page.setContent(loadHtml(), { waitUntil: 'networkidle0' });
  // La capture doit attendre la police, sinon la première pochette sort avec
  // le repli et la mise en page saute.
  await page.evaluate(() => document.fonts.ready);
  const res = await PromiseB
    .filter(playlists.versions, v => playlistToGenerate.includes(v.id))
    .mapSeries(async (version, index) => {
    ++index
    console.log(`[${index}/${playlists.versions.length}]: Generate cover... :${version.text}`)
    await setStyle(page, version)
    const pathToFile = path.resolve(coverDir, `${index}-${version.id}.png`)
    const b64 = await screen(page, pathToFile)
    version.coverB64 = b64
    return { version, b64 }
  })
  if (!isEditable) {
    await page.close().catch(() => { })
    await page.browser().close().catch(() => { })
  }
  return res
}

/** L'ARL est-il exploitable ? En prévisualisation, on ne demande rien. */
async function checkAuth() {
  if (isPreviewMode) {
    console.log('=> Mode prévisualisation : aucune écriture sur Deezer.')
    return false
  }
  try {
    await remotePlaylists()
    console.log('=> ARL accepté par Deezer.')
    return true
  } catch (err) {
    console.log('=> ' + err.message + ' — génération des images seulement.')
    return false
  }
}

async function updateDeezer() {
  return PromiseB.mapSeries(playlists.versions, async (version, index) => {
    console.log(`[${index + 1}/${playlists.versions.length}]: Upload infos... :${version.text}`)
    if (!version.playlistId) {
      console.log('   (pas d\'identifiant Deezer, ignorée)')
      return
    }
    await updateCover(version.playlistId, version.coverB64)
    // `updateInfos: false` : pochette seule, le titre et la description de la
    // playlist restent tels quels (hors de la série numérotée, ils sont à toi).
    if (version.updateInfos === false) return
    if (version.playlistTitle) await updateInfos(version.playlistId, version, getPrefix(version, index))
  })
}
async function showPreviews() {
  var watcher = chokidar.watch(path.resolve(__dirname, 'assets'), { ignored: /^\./, persistent: true });
  const page = await getPage('about:blank')
  async function reload() {
    playlists = getConf()
    await page.setContent('Generate covers, please wait...')
    await generateCovers(process.argv.slice(3).filter(arg => !['--editable', '--preview'].includes(arg)))
    const html = buildPreviewHtml()
    await page.setContent(html)
  }
  watcher
    .on('add', reload)
    .on('change', reload)
    .on('unlink', reload)
  return reload()
}

function buildPreviewHtml() {
  let html = playlists.versions.map((version, index) => {
    return version.coverB64 ? `
      <div class="container">
        <img src="data:image/png;base64,${version.coverB64}"></img>
        <div class="title">${getPrefix(version, index)}${version.playlistTitle}</div>
      </div>` : ''
  }).join('')
  html += `
    <style>
      .container {
        display: flex;
        flex-direction: column;
        flex-grow: 0;
        max-width:400px;
      }
      body {
        display: flex;
        flex-wrap: wrap;
        gap: 20px;
        height: max-content;
      }
      .title {
        text-align: center;
        font-weight: bold;
        font-size: 1.2em;
      }
    </style>
    `
  return html
}

function getConf() {
  const playlists = fs.readFileSync(path.resolve(__dirname, 'assets', 'playlists.json'), 'utf-8')
  return JSON.parse(playlists)
}