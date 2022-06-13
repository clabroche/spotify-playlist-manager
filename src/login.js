const { getPage } = require("./browser")
const axios = require('axios').default
const fs = require('fs')
const path = require('path')
const { isPreviewMode } = require("./cli")

const accessTokenPath = path.resolve(__dirname, '..', 'access_token')

module.exports = {
  access_token: getSavedAccessToken(),
  async oauth() {
    const oauth = require('./oauth')
    if (this.access_token) {
      const isAuthenticated = await checkAuth(this.access_token)
      if (!isAuthenticated) this.access_token = undefined
    }
    if (!this.access_token && !isPreviewMode) {
      const page = await getPage(`http://localhost:5000/login?client_id=${process.env.client_id}&client_secret=${process.env.client_secret}`)
      const browser = page.browser()
      let stopPoll = false
      while (!this.access_token && !stopPoll) {
        page.on('close', () => stopPoll = true)
        const { data: token } = await axios.get('http://localhost:5000/poll-token')
        if (token) this.access_token = token
        await new Promise(res => setTimeout(res, 100))
      }
      console.log('=> Token: ', this.access_token)
      if (this.access_token) saveAccessToken(this.access_token)
      await page.close().catch(() => { })
      await browser.close().catch(() => { })
    }
    const isAuthenticated = await checkAuth(this.access_token)

    if (isPreviewMode) console.log('=> Launch on preview mode')
    else if (isAuthenticated) console.log('=> Token is Good...')
    else console.log('=> Can\'t connect to spotify, generate files only...')

    await oauth.close()
    return isAuthenticated
  }
}

async function checkAuth(access_token) {
  const { data: me } = await axios.get('https://api.spotify.com/v1/me', {
    headers: {
      Authorization: 'Bearer ' + access_token,
    }
  }).catch(() => ({ data: null }))
  return me ? true : false
}

function getSavedAccessToken() {
  if (fs.existsSync(accessTokenPath)) return fs.readFileSync(accessTokenPath, 'utf-8')
  return
}
function saveAccessToken(access_token) {
  return fs.writeFileSync(accessTokenPath, access_token, 'utf-8')
}