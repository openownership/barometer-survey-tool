<?php
/**
 * W3F Web Index Survey - Google Spreadsheets POST proxy
 *
 * Copyright (C) 2014  Ben Doherty @ Oomph, Inc.
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

require_once dirname(__FILE__) . '/../vendor/autoload.php';
require_once dirname(__FILE__) . '/survey-config.php';


/************************************************
  Make an API request authenticated with a service
  account.
 ************************************************/

$client = new Google_Client();
$client->setApplicationName( "W3F Survey" );

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


$client->setAuthConfig(SERVICE_ACCOUNT);
$client->addScope('https://spreadsheets.google.com/feeds');

// @TODO Check for invalid (revoked)token as well 
if( $client->isAccessTokenExpired()) {
	$client->refreshTokenWithAssertion();
}
$access_token = $client->getAccessToken()['access_token'];

/************************************************
  Routing & sanitizing
 ************************************************/

// Submit
if ( 'submit' == $_GET['action'] ) {
    //print_r($_POST);
    if (!isset($_GET['url'])) {
        fail('URL not set');
    }
    if (!isset($_GET['method'])) {
        fail('Method not set');
    }
    submit($access_token, $_GET['url'], $_GET['method']);
}
// Retreive
if ( 'retreive' == $_GET['action'] ) {
    if (!isset($_GET['url'])) {
        fail('URL not set');
    }
    submit($access_token, $_GET['url'], 'GET');
}

/************************************************
  Functions
 ************************************************/

function submit($access_token, $url, $method) {
        
        // Further sanity checks
        if( strpos( $url, 'https://spreadsheets.google.com/feeds/') !== 0 ) {
                fail( "Invalid URL" );
        }

        if( $method != 'POST' && $method != 'PUT' && $method != 'DELETE' && $method != 'GET' ) {
                fail( "Invalid method" );
        }

        $ch = curl_init( $url );

        $http_headers = array(  
                'Authorization: Bearer ' . $access_token,
                'Content-Type: application/atom+xml'
        );
        
        if( $method != 'DELETE' && $method != 'GET' ) {
                $payload = '<entry xmlns="http://www.w3.org/2005/Atom" xmlns:gsx="http://schemas.google.com/spreadsheets/2006/extended">';

                foreach( $_POST as $var => $val ) {
                        $payload .= '<gsx:' . $var . '>' . htmlspecialchars( $val ) . '</gsx:' . $var . '>';
                }

                $payload .= '</entry>';

                $http_headers[] = 'Content-Length: ' . strlen( $payload );

                curl_setopt( $ch, CURLOPT_POSTFIELDS, $payload );
        }


        curl_setopt( $ch, CURLOPT_CUSTOMREQUEST, $method );
        curl_setopt( $ch, CURLOPT_RETURNTRANSFER, true );
        curl_setopt( $ch, CURLOPT_HEADER, true );
        curl_setopt( $ch, CURLOPT_HTTPHEADER, $http_headers );
        
        $result = curl_exec( $ch );

        if( !$result ) {
                http_response_code( 503 );
                exit( 0 );
        }

        list( $headers, $body ) = explode( "\r\n\r\n", $result, 2 );

        $headers = explode( "\r\n", $headers );

        foreach( $headers as $header ) {
                list( $header_name, $header_val ) = explode( ':', $header, 2 );

                $headers[$header_name] = $header;
        }

        header( $headers[0] );
        header( $headers['Content-Type'] );

        echo $body;
}

function fail( $message ) {
    	$response = array(
		'error' => $message
	);
	header( '401 Bad Request' );
	header( 'Content-Type: text/plain' );

	exit( json_encode( $response ) );       
}