const express = require('express');
const querystring = require('querystring');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const { default: Axios } = require('axios');

let client_id
let client_secret
let token = null
const redirect_uri = 'http://localhost:5000/callback';
const scope = 'playlist-modify-public playlist-modify-private ugc-image-upload';

const app = express();
app.use(cookieParser());
app.use(bodyParser.json());

const stateKey = 'spotify_auth_state';

app.set('port', (process.env.PORT || 5000));

app.use(express.static(__dirname + '/public'));

app.all('*', function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Cache-Control, Pragma, Origin, Authorization, Content-Type, X-Requested-With");
  res.header("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS");
  next();
});

/** Used to get token in used */
app.get('/poll-token', (req, res) => {
  res.json(token)
})

/** log to spotify */
app.get('/login', function (req, res) {
  console.log('=> Login')
  client_id = req.query.client_id
  client_secret = req.query.client_secret
  const state = generateRandomString(16);

  res.cookie(stateKey, state);

  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: client_id ? client_id.toString() : '',
      scope: scope,
      redirect_uri: redirect_uri,
      state: state
    }));
});

app.get('/callback', async function (req, res) {
  console.log('=> Callback')
  const code = req.query.code || null;
  const state = req.query.state || null;
  const storedState = req.cookies ? req.cookies[stateKey] : null;

  if (!state || state !== storedState) {
    console.log('State is different we cannot process oAuth for your security');
    res.json({
      expires_in: null,
      access_token: null,
    });
  } else {
    res.clearCookie(stateKey);
    const requestData = {
      grant_type: 'authorization_code',
      code: code ? code.toString() : '',
      redirect_uri
    }
    const url = `https://accounts.spotify.com/api/token`
    const config = {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${client_id}:${client_secret}`).toString('base64')
      }
    }
    const { data, status } = await Axios.post(url, querystring.stringify(requestData), config)

    if (status === 200) {
      var access_token = data.access_token,
        expires_in = data.expires_in;
      token = access_token
      res.json({
        access_token, expires_in
      })
    } else {
      res.json({
        access_token: null,
        expires_in: null
      });
    }
  }
});

module.exports = app.listen(app.get('port'), function () {
  console.log('Oauth server run on port', app.get('port'));
});

/**
 * Generates a random string containing numbers and letters
 * @param  {number} length The length of the string
 * @return {string} The generated string
 */
var generateRandomString = function (length) {
  var text = '';
  var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (var i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};