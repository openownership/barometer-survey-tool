<?php
/**
 * W3F Web Index Survey - Config for Google Drive upload proxy
 *
 * Copyright (C) 2014  Jason LeVan @ Oomph, Inc.
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

// Values for the service account
// SERVICE_ACCOUNT_NAME should be the email address for the service account
// KEY_FILE_LOCATION should be a relative path to the location of the .p12 key (DEPRECATED)
// SERVICE_ACCOUNT should be a json service account file
// FILES_FOLDER should by the Google Drive key of the default folder to save files into

define('SERVICE_ACCOUNT_NAME', 'X@X.iam.gserviceaccount.com');
define('KEY_FILE_LOCATION', '../xxxxxxx.p12');
define('SERVICE_ACCOUNT','../xxxxx.json');
define('FILES_FOLDER','1hZFdzyb6dcTJeETnTHqjW4taRr-G-CQI');