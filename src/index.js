const fs = require('fs')
const path = require('path')
const chokidar = require('chokidar')
const PromiseB = require('bluebird')
require('dotenv').config()
const login = require('./login')
const { getPage, screen, close: browserClose } = require('./browser')
const { updateCover, updateInfos } = require('./spotify')
const { isPreviewMode } = require('./cli')
const coverDir = path.resolve(__dirname, '..', 'output')

let playlists = getConf()

if (!fs.existsSync(coverDir)) fs.mkdirSync(coverDir)

  ; (async _ => {
    const isLogged = await login.oauth()
    console.log('Image generation...')

    if (isPreviewMode) await showPreview()
    else await generateCovers()

    if (isLogged && !isPreviewMode) await updateSpotify()
  })().catch(async err => {
    console.error(err?.response?.data || err?.response?.status || err)
    await browserClose()
    process.exit(1)
  })

async function setStyle(page, version) {
  await page.evaluate((version) => {
    const root = document.querySelector('.root')
    if (root === null) return
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
  }, version)
}

function loadHtml() {
  let contentHtml = fs.readFileSync(path.resolve(__dirname, 'assets', 'index.html'), 'utf8');
  const backgroundImagePath = path.resolve(__dirname, 'assets', playlists.backgroundImage)
  if (fs.existsSync(backgroundImagePath)) {
    const backgroundImage = fs.readFileSync(backgroundImagePath);
    const b64 = 'data:image/png;base64,' + Buffer.from(backgroundImage).toString('base64');
    contentHtml = contentHtml.replace('{{background}}', b64)
  }
  return contentHtml
}

function getPrefix(version, index) {
  return version.prefix
    ? version.prefix.replace('{{order}}', index.toString().padStart(2, '0'))
    : ''
}

async function generateCovers() {
  const page = await getPage('about:blank', { headless: true })
  await page.setContent(loadHtml());
  const res = await PromiseB.mapSeries(playlists.versions, async (version, index) => {
    ++index
    console.log(`[${index}/${playlists.versions.length}]: Generate cover... :${version.text}`)
    await setStyle(page, version)
    const pathToFile = path.resolve(coverDir, `${index}-${version.id}.png`)
    const b64 = await screen(page, pathToFile)
    version.coverB64 = b64
    return { version, b64 }
  })
  await page.close().catch(() => { })
  await page.browser().close().catch(() => { })
  return res
}

async function updateSpotify() {
  return PromiseB.mapSeries(playlists.versions, async (version, index) => {
    ++index
    console.log(`[${index}/${playlists.versions.length}]: Upload infos... :${version.text}`)
    if (version.playlistId) await updateCover(version.playlistId, version.coverB64)
    if (version.playlistTitle) await updateInfos(version.playlistId, version, getPrefix(version, index))
  })
}
async function showPreview() {
  var watcher = chokidar.watch(path.resolve(__dirname, 'assets'), { ignored: /^\./, persistent: true });

  const page = await getPage('about:blank')
  async function reload() {
    playlists = getConf()
    await page.setContent('Generate covers, please wait...')
    await generateCovers()
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
    return `
      <div class="container">
        <img src="data:image/png;base64,${version.coverB64}"></img>
        <div class="title">${getPrefix(version, index)}${version.playlistTitle}</div>
      </div>`
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