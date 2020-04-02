<?php
/**
 * W3F Web Index Survey - Google Drive proxy
 *
 * Copyright (C) 2014  Ben Doherty, Jason LeVan @ Oomph, Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

session_start();

require_once dirname(__FILE__) . '/../vendor/autoload.php';
require_once dirname(__FILE__) . '/survey-config.php';

/************************************************
  Make an API request authenticated with a service
  account.
 ************************************************/
$client = new Google_Client();

$client->setAuthConfig(SERVICE_ACCOUNT);

$client->setApplicationName( "W3F Survey" );
$client->addScope('https://www.googleapis.com/auth/drive');

$service = new Google_Service_Drive( $client );

/************************************************
  If we have an access token, we can carry on.
  Otherwise, we'll get one with the help of an
  assertion credential. In other examples the list
  of scopes was managed by the Client, but here
  we have to list them manually. We also supply
  the service account
 ************************************************/

if ( isset( $_SESSION['service_token'] ) ) {
	$client->setAccessToken( $_SESSION['service_token'] );
}

if( $client->isAccessTokenExpired()) {
    $client->refreshTokenWithAssertion();
}

$access_token = $client->getAccessToken()['access_token'];


/************************************************
  Routing
 ************************************************/

// Grant Permissions
if ( 'grantPerms' == $_GET['action'] ) {
    if (isset($_GET['email']) && isset($_GET['file_id'])) {
        grantPermissions(
            $service,
            $_GET['email'], 
            $_GET['file_id'],
            $_GET['role'],
            $_GET['user']
        );
    } else {
        exit(json_encode(array('error'=>'No file specified or no user specified')));
    }
} 
// Upload File
elseif ( 'upload' == $_GET['action'] ) {
    $found = false;
    if (isset($_GET['filename'])) {
        foreach($_FILES as $file) {
            if ($_GET['filename'] == $file['name']) {
                uploadFile(
                    $service,
                    $file,
                    $_GET['country']
                );
                $found = true;
            }
        }
    } 
    if (!$found) {
        exit(json_encode(array('error'=>'No file specified')));
    }
}

/************************************************
  Functions
 ************************************************/

function grantPermissions($service, $email, $file_id, $type, $role) {

    if (!$type || $type == '') { $type = 'user'; }
    if (!$role || $role == '') { $role = 'reader'; }
    
    $newPermission = new Google_Service_Drive_Permission();
    $newPermission->setRole( $role );
    $newPermission->setType( $type );
    $newPermission->setEmailAddress( $email );

    try {
            $perm = $service->permissions->create( $file_id, $newPermission, array('sendNotificationEmail' => false) );
            exit( json_encode( $perm ) );
    } catch ( Exception $e ) {
            $response = array(
                    'error' => $e->getMessage()
            );
            header("HTTP/1.0 502 Bad Gateway");
            exit( json_encode( $response ) );
    }
    
}

function uploadFile($service, $uploadedfile, $country = false) {

    if (!is_uploaded_file($uploadedfile['tmp_name'])) {
            $response = array(
                'error' => 'Bad file'
            );
            header("HTTP/1.0 403 Forbidden");
            exit (json_encode($response));
    }
    
    $file = new Google_Service_Drive_DriveFile();
    $title = ($country) ? $country . ' - ' . $uploadedfile['name'] : $uploadedfile['name'];
    $file->setName($title);    
    $file->setParents(array('1hZFdzyb6dcTJeETnTHqjW4taRr-G-CQI'));
    
    try {
            $result = $service->files->create(
                    $file,
                    array(
                      'data' => file_get_contents($uploadedfile['tmp_name']),
                      'mimeType' => 'application/octet-stream',
                      'uploadType' => 'multipart'
                    )
            );
            $result = $service->files->get($result->id, array('fields'=>'*'));
            exit(json_encode($result));  
    } catch ( Exception $e ) {
            $response = array(
                    'error' => $e->getMessage()
            );
            header("HTTP/1.0 502 Bad Gateway");
            exit( json_encode( $response ) );
    }
      
}