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

require_once dirname(__FILE__) . '../vendor/autoload.php';
require_once dirname(__FILE__) . '/survey-config.php';

/************************************************
  Make an API request authenticated with a service
  account.
 ************************************************/


if ( !defined( 'SERVICE_ACCOUNT_NAME' ) || !defined( 'KEY_FILE_LOCATION' ) ) {
	$response = array(
		'error' => 'Ensure config.php is properly filled out'
	);

	header("HTTP/1.0 500 Internal Server Error");
	exit( json_encode( $response ) );
}

$client = new Google_Client();
$client->setApplicationName( "W3F Survey" );
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
$key = file_get_contents( KEY_FILE_LOCATION );

$credentials = new Google_Auth_AssertionCredentials(
	SERVICE_ACCOUNT_NAME,
	array( 'https://www.googleapis.com/auth/drive' ),
	$key
);

$client->setAssertionCredentials( $credentials );
if( $client->getAuth()->isAccessTokenExpired() ) {
	$client->getAuth()->refreshTokenWithAssertion( $credentials );
}
$_SESSION['service_token'] = $client->getAccessToken();

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
    $newPermission->setValue( $email );

    try {
            $perm = $service->permissions->insert( $file_id, $newPermission, array('sendNotificationEmails' => false) );
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
    $file->setTitle($title);    
    
    try {
            $result = $service->files->insert(
                    $file,
                    array(
                      'data' => file_get_contents($uploadedfile['tmp_name']),
                      'mimeType' => 'application/octet-stream',
                      'uploadType' => 'multipart'
                    )
            );
            exit(json_encode($result));  
    } catch ( Exception $e ) {
            $response = array(
                    'error' => $e->getMessage()
            );
            header("HTTP/1.0 502 Bad Gateway");
            exit( json_encode( $response ) );
    }
      
}