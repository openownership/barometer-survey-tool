/* 
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */

// OAuth 2.0 client ID for "Web application client" (set in developers console)
var CLIENT_ID = '333545842886-tocobflgg35ei3c5orgd7hdbpsecr4t5.apps.googleusercontent.com';
// OAuth 2.0 client ID for "Service account client" (set in developers console)
var SERVICE_ACCOUNT = '333545842886-o72vrqsf58800nu1g9jdjjd1r564lp2k@developer.gserviceaccount.com';
// Scope definition of Google API's to access
var SCOPE = 'profile email https://spreadsheets.google.com/feeds https://www.googleapis.com/auth/drive';

// local variables
var timer = null;
// The ID of the access token in local storage - must match other scripts!
var access_token_id = 'W3FAT';

window.init = function() {
    gapi.load('auth2', function() {
        auth2 = gapi.auth2.init({
            client_id: CLIENT_ID,
            fetch_basic_profile: true,
            scope: SCOPE
        });

        auth2.isSignedIn.listen(signinChanged);
        auth2.currentUser.listen(userChanged);
        
        auth2.signIn();
        checkSignIn();
    });
}

window.checkSignIn = function() {
    if (!auth2.isSignedIn.get()) {
        showSignIn();
        return false;
    } else {
        // Signed in, validate and store token
        var auth = auth2.currentUser.get().getAuthResponse();
        if (!auth) {
            return false;
        }
        // validate token
        localStorage.setItem(access_token_id,auth.access_token);
        console.log(auth.access_token);
        // setTimeout
        timer = setTimeout(refresh, auth.expires_in * 0.75 * 1000);
        // Update UI
        //showUser();
        return true;
    }
}

window.showSignIn = function() {
    gapi.signin2.render('signin2-button', {
        'scope': SCOPE,
        'width': 220,
        'height': 50,
        'longtitle': true,
        'theme': 'dark',
        'onsuccess': signInSuccess,
        'onfailure': signInFailure
    });
    return;
}

window.showUser = function() {
    var email = auth2.currentUser.get().getBasicProfile().getEmail();
    document.getElementById("signin2-button").innerHTML = email;
}

window.signInSuccess = function(googleUser) {
    console.log('Success, logged in!');
}

window.signInFailure = function() {
    console.log('Failure, could not sign you in!');
} 

window.signinChanged = function(val) {
    //checkSignIn();
};

window.userChanged = function(user) {
    console.log("User Changed");
    checkSignIn();
}

window.refresh = function() {
    location.reload();
}

window.validateToken = function(token) {
    var url = "https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=";
    var oReq = new XMLHttpRequest();
    oReq.addEventListener("load", function() {
    
    });
    oReq.open("GET", url + tokes);
    oReq.send();
}