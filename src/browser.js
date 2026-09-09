const puppeteer = require('puppeteer')
const { isPreviewMode } = require('./cli')
// 400 × 2.5 = 1000 px, la taille servie par le CDN de Deezer.
const SCALE = 2.5
let pageGlobal
let browserGlobal
module.exports = {
  async getPage(url, conf = {}) {
    // Le Chromium de puppeteer n'est pas téléchargé (scripts d'install
    // bloqués par npm) : on prend celui du système.
    const browser = await puppeteer.launch(Object.assign({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      defaultViewport: null,
      headless: false,
      // devtools: true
    }, conf))
    const page = await browser.newPage()
    // Le gabarit est dessiné en 400 px ; Deezer sert la pochette jusqu'en
    // 1000. On garde la mise en page et on multiplie les pixels.
    await page.setViewport({ width: 400, height: 400, deviceScaleFactor: SCALE })
    pageGlobal = page
    browserGlobal = browser
    await page.goto(url)
    return page
  },
  /** @param {import('puppeteer').Page} page */
  async screen(page, path) {
    const conf = {
      clip: {
        x: 0,
        y: 0,
        width: 400,
        height: 400,
      },
    }
    if (path && !isPreviewMode) {
      await page.screenshot({
        ...conf,
        path
      })
    }
    return page.screenshot({
      ...conf,
      encoding: 'base64',
      type: 'jpeg',
    })
  },
  async close() {
    await pageGlobal.close().catch(() => { })
    await browserGlobal.close().catch(() => { })
  }
}