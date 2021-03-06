var express = require('express');
var util = require('./lib/utility');
var partials = require('express-partials');
var bodyParser = require('body-parser');
var Promise = require('bluebird');
var expressSession = require('express-session');
var passport = require('passport');
//var OAuthStrategy = require('passport-oauth').OAuthStrategy;
var GitHubStrategy = require('passport-github').Strategy;


var db = require('./app/config');
var Users = require('./app/collections/users');
var User = require('./app/models/user');
var Links = require('./app/collections/links');
var Link = require('./app/models/link');
var Click = require('./app/models/click');

var app = express();

app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');
app.use(partials());
// Parse JSON (uniform resource locators)
app.use(bodyParser.json());
// Parse forms (signup/login)
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname + '/public'));
var session = { path: '/',
                httpOnly: true,
                secure: false,
                secret: 'sarah is da bomb',
                cookie: {maxAge: 3600000, secure: false},
                maxAge: 3600000,
                userid: null,
                resave: false,
                saveUninitialized: true
                // genid: function(req) { return genuuid();}
              };

app.use(expressSession(session));
app.use(passport.initialize());
app.use(passport.session());

passport.use(new GitHubStrategy({
    clientID: 'GITHUB_ID',
    clientSecret: 'GITHUB_SECRET',
    callbackURL: 'http://127.0.0.1:4568/auth/github/callback'
  },
  function(accessToken, refreshToken, profile, done) {
    new User({ username: profile.username }).fetch()
    .then(function(found) {
      if (!found) {
        var dbUser = new User ({
          username: profile.username,
          password: null,
          salt: null,
          authentication: 'github'
        });

        dbUser.save().then(function(newUser) {
          profile.userid = newUser.get('user_id');
          Users.add(newUser);
        });
      }
      else {
        profile.userid = found.attributes.id;
      }

      return done(null, profile);
    });
  }

));

passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(obj, done) {
  done(null, obj);
});

app.get('/',
function(req, res) {
  res.render('index');
});

app.get('/auth/github',
passport.authenticate('github'));

app.get('/auth/github/callback',
passport.authenticate('github', { failureRedirect: '/login' }),
  function(req, res) {
    req.session.regenerate( function (err) {});
    req.session.userid = req.user.userid;
    // Successful authentication, redirect home.
    res.redirect('/create');
});

app.get('/login',
function(req, res) {
  res.render('login');
});

app.get('/logout',
function(req, res) {
  req.logout();
  req.session.destroy(req.session.sid, function(err){});
  res.render('login');
});

app.get('/signup',
function(req, res) {
  res.render('signup');
});

app.get('/create',
function(req, res) {
  res.render('index');
});

app.get('/links',
function(req, res) {
  var userid = req.session.userid;

  Links.reset().query('where', 'user_id', '=', userid).fetch().then(function(links) {
    res.send(200, links.models);
  });
});

app.post('/signup',
  function(req, res){
    // grab user
    var generatedSalt;

    util.generateUserSalt()
      .then( function (salt) {
        generatedSalt = salt;
        return util.generateUserHash(req.body.password, salt);
      })
      .then( function (hash){
        // write to the user dbUser
        var dbUser = new User ({
          username: req.body.username,
          password: hash,
          salt: generatedSalt,
          authentication: 'local'
        });

        dbUser.save().then(function(newUser) {
          Users.add(newUser);
          res.redirect('/login');
        });
      });
});

app.post('/login',
  function(req, res){

    new User({ username: req.body.username }).fetch().then(function(found) {
      if ( found ) {
        util.generateUserHash(req.body.password, found.attributes.salt)
          .then( function( hash ) {
            if ( hash === found.attributes.password) {

              req.session.regenerate( function (err) {});
              req.session.userid = found.attributes.id;
              res.redirect('/create');
            }
            else {
              res.send(401);
            }
          });
      }
    });
});

app.post('/links',
function(req, res) {
  var uri = req.body.url;
  if (!util.isValidUrl(uri)) {
    console.log('Not a valid url: ', uri);
    return res.send(404);
  }

  var userid = req.session.userid || null;

  new Link({ url: uri, user_id: userid }).fetch().then(function(found) {
    if (found) {
      res.send(200, found.attributes);
    } else {
      util.getUrlTitle(uri, function(err, title) {
        if (err) {
          console.log('Error reading URL heading: ', err);
          return res.send(404);
        }


        var link = new Link({
          user_id: userid,
          url: uri,
          title: title,
          base_url: req.headers.origin
        });

        link.save().then(function(newLink) {
          Links.add(newLink);
          res.send(200, newLink);
        });
      });
    }
  });
});

/************************************************************/
// Write your authentication routes here
/************************************************************/



/************************************************************/
// Handle the wildcard route last - if all other routes fail
// assume the route is a short code and try and handle it here.
// If the short-code doesn't exist, send the user to '/'
/************************************************************/

app.get('/*', function(req, res) {
  new Link({ code: req.params[0] }).fetch().then(function(link) {
    if (!link) {
      res.redirect('/');
    } else {
      var click = new Click({
        link_id: link.get('id')
      });

      click.save().then(function() {
        db.knex('urls')
          .where('code', '=', link.get('code'))
          .update({
            visits: link.get('visits') + 1,
          }).then(function() {
            return res.redirect(link.get('url'));
          });
      });
    }
  });
});

console.log('Shortly is listening on 4568');
app.listen(4568);
