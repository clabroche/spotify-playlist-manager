const login = require("./login")
const axios = require("axios").default

module.exports = {
  async updateCover(playlistId, base64) {
    await axios.put(`https://api.spotify.com/v1/playlists/${playlistId}/images`, base64, {
      headers: {
        Authorization: 'Bearer ' + login.access_token,
        'Content-Type': 'image/jpeg'
      },
    })
  },
  async updateInfos(playlistId, version, prefix = '') {
    await axios.put(`https://api.spotify.com/v1/playlists/${playlistId}`, {
      name: prefix + version.playlistTitle,
      public: version.public ? true : false,
      description: version.description ? version.description : undefined
    }, {
      headers: {
        Authorization: 'Bearer ' + login.access_token,
      },
    })
  }
}