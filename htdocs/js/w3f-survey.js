/**
 * W3F Web Index Survey
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

var write, uploadCb;

// Gimme a range op!
Array.prototype.range = function (n) {
  return Array.apply(null, Array(n)).map(function (_, i) { return i; });
}

// How do we format dates?
Date.prototype.format = function () {
  return this.toDateString() + ", " + this.toLocaleTimeString();
}

angular.module('W3FWIS', ['GoogleSpreadsheets', 'GoogleDrive', 'W3FSurveyLoader', 'ngCookies', 'ngRoute', 'ngSanitize'])
  // Setup route. There's only one route, and it's /<answerSheetKey>
  .config(['$routeProvider', '$locationProvider', function ($routeProvider, $locationProvider) {
    $routeProvider.when('/:answerKey?/:masterKey?', {
      controller: 'W3FSurveyController',
      templateUrl: 'tpl/survey.html'
    });

    $locationProvider.html5Mode(true);
  }])

  // Create "country" filter
  .filter('country', ['$rootScope', function ($rootScope) {
    return function (input) {
      return input.replace('[country]', $rootScope.country);
    }
  }])

  // Create "markdown" filter
  .filter('markdown', function ($rootScope) {
    return function (input) {
      var linkRegex = /(.{1,2})?\b(https?\:\/\/[^,\s|\[\]\(\)]+)/g,
        matches,
        markdownLink;

      // Replace links with their markdown equivalent. Don't do this for
      // already marked-down or auto-linked links.
      while (matches = linkRegex.exec(input)) {
        if (matches[1] && (matches[1] == '](' || matches[1].substr(-1) == '<')) {
          continue;
        }
        // escape underscores in link representation
        var linkTitle = matches[2].replace(/_/g, '\\_');
        var markdownLink = '[' + linkTitle + '](' + matches[2] + ')';
        input = input.replace(matches[2], markdownLink);
        linkRegex.lastIndex += markdownLink.length - matches[2].length;
      }

      return markdown.toHTML(input);
    }
  })

  // Top-level controller
  .controller('W3FSurveyController', ['loader', 'spreadsheets', '$scope', '$rootScope', '$q', '$cookies', '$routeParams', '$interval', '$http', function (loader, gs, $scope, $rootScope, $q, $cookies, $routeParams, $interval, $http) {
    var answerKey = $routeParams.answerKey, queue;

    if ($routeParams.masterKey == 'clear') {
      // Clear out my local storage and redirect back
      delete localStorage['queue-' + answerKey];
      location.pathname = answerKey;
      return;
    }

    if ($routeParams.masterKey == 'readonly') {
      // Force readonly mode
      $rootScope.forceReadOnly = true;
      $routeParams.masterKey = '';
    }

    if ($routeParams.masterKey) {
      window.MASTER_KEY = $routeParams.masterKey;
    }

    // Who's doing the Survey? Determined by answer sheet, defaults to "Anonymous"
    $rootScope.participant = 'Anonymous';

    // Section order and descriptors
    $rootScope.sectionOrder = [];
    $rootScope.sections = {};

    // Questions by Section ID
    $rootScope.questions = {};

    // Responses by question ID, as a watched scope model
    $rootScope.responses = {};

    // We're loading... !
    $rootScope.loading = false;
    $rootScope.loaded = true;

    // Notes by Question ID
    $rootScope.notes = {};

    // Uploads
    $rootScope.uploads = {}
    $rootScope.queuedUploads = {}

    // (Unresolved) note counts by section ID
    $rootScope.noteCount = {};

    // Anonymous until proven otherwise
    $rootScope.anonymous = true;

    // Control sheet values
    $rootScope.control = {};

    // Links to answer sheet rows by question id,
    // or control sheet rows by value
    $rootScope.links = {
      responses: {},
      control: {}
    };

    // Set up an initial page
    $rootScope.activeSection = $cookies.section;

    // Navigate to a different section
    $rootScope.navigate = function (section, nextNote) {
      if (section != $rootScope.activeSection) {
        $rootScope.activeSection = $cookies.section = section;
        window.scroll(0, 0);
        window.location.hash = '';
        return;
      }

      if (nextNote) {
        var st = parseInt(window.scrollY),
          min = Number.MAX_SAFE_INTEGER,
          $skipTo, $firstNote, skipHeight;

        _.each($rootScope.notes, function (notes, questionid) {
          var question = $rootScope.questions[questionid];

          if (question.sectionid != section) {
            return;
          }

          for (var i = 0; i < notes.length; i++) {
            if (!notes[i].resolved) {
              var $el = $('#note-' + question.qid + '-' + notes[i].field),
                diff = parseInt($el.offset().top) - st - 60;

              if (!$el.length) {
                continue;
              }

              $el.offsetTop = parseInt($el.offset().top);

              if (!$firstNote || $el.offsetTop < $firstNote.offsetTop) {
                $firstNote = $el;
              }

              if (diff > 0 && diff < min) {
                $skipTo = $el;
                min = diff;
              }
            }
          }
        });

        if ($firstNote && !$skipTo) {
          $skipTo = $firstNote;
        }

        if ($skipTo) {
          window.scroll(0, $skipTo.offsetTop - 60);
        }
      }
    }

    // Continue with the survey, read-only
    $rootScope.continueReadonly = function () {
      $rootScope.readOnly = true;

      $rootScope.status.locked = false;
    }

    // Count unresolved notes in a particular section, or if coordinator,
    // count ALL unresolved notes
    $rootScope.countNotes = function (sectionid) {
      var sections = sectionid ? [sectionid] : $rootScope.sectionOrder;
      var totalCount = 0;

      _.each(sections, function (sectionid) {
        var count = 0;
        var munge = function (questions) {
          _.each(questions, function (question) {
            var notes = $rootScope.notes[question.questionid];
            var fields = {};

            for (i = 0; i < notes.length; i++) {
              if (!fields[notes[i].field] && !notes[i].resolved) {
                count++;
                fields[notes[i].field] = true;
              }
            }

            munge(question.subquestions);
          });
        }

        munge($rootScope.sections[sectionid].questions);

        $rootScope.noteCount[sectionid] = count;

        totalCount += count;
      });

      return totalCount;
    }

    // toLocaleString a timestamp
    $rootScope.localeTimeString = function (ts) {
      var d = new Date();

      d.setTime(ts)

      return d.toLocaleString();
    }

    // Take over a survey
    $rootScope.takeover = function () {
      var lastAccess = $rootScope.control['Last Access'];

      loader.loadControlValues().then(function () {
        if ($rootScope.control['Last Access'] != lastAccess) {
          // Someone's change it since we last looked at it. Just reload
          location.reload();
          return;
        }

        // Otherwise, stomp it out!
        $rootScope.lockSurvey();
      });
    }

    // Create or update the lock for this survey
    $rootScope.lockSurvey = function () {
      var lockString = new Date().getTime() + '|' + $rootScope.participant,
        record = {
          field: 'Last Access',
          value: lockString
        },
        promise;

      if ($rootScope.links.control['Last Access']) {
        promise = gs.updateRow($rootScope.links.control['Last Access'].edit, record);
      }
      else {
        promise = gs.insertRow($rootScope.answerSheets.Control, record);
      }

      promise.then(function () {
        $rootScope.status.locked = false;
        $cookies['lockString-' + answerKey] = $rootScope.lockString = lockString;
        $rootScope.control['Last Access'] = lockString;
      });
    };

    // Clear the lock for this survey. Do this when we navigate away or complete
    $rootScope.unlockSurvey = function () {
      // ADDED TO AVOID FAILING WHEN THE CONTROL DOES NOT EXIST
      if ($rootScope.links.control['Last Access']) {
        gs.deleteRow($rootScope.links.control['Last Access'].edit);
      }
    }

    // Potential status flow
    $rootScope.statusFlow = {
      'recruitment': {
        party: '',
        nextStates: ['assigned'],
        button: "Reset to Recruitment",
        label: "Recruitment",
        transitionMessage: "This completes the Recruitment phase of the survey"
      },
      'assigned': {
        party: 'Researcher',
        nextStates: ['spotcheck'],
        button: "Assign to Researcher",
        label: "Initial Research",
        transitionMessage: "This completes the Initial Research phase of the survey"
      },
      'spotcheck': {
        party: 'Coordinator',
        nextStates: ['clarification', 'review', 'validation', 'complete'],
        button: "Send to the next stage",
        label: "Spot-Check",
        transitionMessage: "This completes the Spot-check phase of the survey"
      },
      'clarification': {
        party: 'Researcher',
        nextStates: ['spotcheck'],
        button: "Send to Researcher",
        label: "Clarification",
        transitionMessage: "This completes the Clarification phase of the survey"
      },
      'review': {
        party: 'Reviewer',
        nextStates: ['spotcheck', 'validation'],
        button: "Send to Reviewer",
        label: "Review",
        transitionMessage: "This completes the Review phase of the survey"
      },
      'validation': {
        party: 'Coordinator',
        nextStates: ['complete', 'review', 'clarification'],
        button: "It's done",
        label: "Validation",
        transitionMessage: "This completes the Validation phase of the survey"
      },
      'complete': {
        party: '',
        nextStates: [],
        button: "Send to Completion",
        label: "Complete",
        transitionMessage: "The survey is complete and ready for final submission"
      }
    };

    // Queue for data pending saves. Stored in localStorage as well.
    try {
      queue = JSON.parse(localStorage['queue-' + answerKey]);
    }
    catch (e) { };

    if (typeof queue != "object") {
      queue = {
        responses: {},
        notes: {},
        uploads: []
      };
    }

    // Load the survey once we're ready.
    $rootScope.$on('load-survey', function () {
      loader.load(answerKey).then(function (status) {
        // Check the exclusivity lock
        var lastAccess = $rootScope.control['Last Access'],
          matches = lastAccess && lastAccess.match(/^(\d+)\|(.+)$/);

        if ($cookies['lockString-' + answerKey] != lastAccess && matches) {
          var timeDiff_s = (new Date().getTime() - matches[1]) / 1000;

          // Notify caller that it was last accessed less than an hour ago and may be
          // locked
          if (timeDiff_s < 3600 && !$rootScope.readOnly) {
            status.locked = { time: matches[1], role: matches[2] };
          }
        }

        $rootScope.status = status;
        $rootScope.loaded = true;
        $rootScope.loading = false;

        $rootScope.$broadcast('loaded');

        // Lock it up if noone else has
        if (!status.locked) {
          $rootScope.lockSurvey();
        }

        // For any existing responses or notes in the queue, replace the current answers
        _.each(queue.responses, function (response, qid) {
          _.extend($rootScope.responses[qid], response);
        });

        _.each(queue.notes, function (note, qid) {
          _.extend($rootScope.notes[qid], note);
        });

        // Combine queued uploads
        _.each(queue.uploads, function (upload) {
          if (upload && $rootScope.queuedUploads[upload.id]) {
            _.extend($rootScope.queuedUploads[upload.id], upload);
          }
        });

        // Watch uploads
        var syncUploads = function (newUploads, oldUploads) {
          if (oldUploads === newUploads) {
            return;
          }
          queue.uploads = newUploads
        }

        $rootScope.$watchCollection("queuedUploads", syncUploads);

        // Only now that the answer sheet has been loaded
        // do we watch for changes to the responses that might
        // come from the user.
        //
        // Watch responses to add any changes to the save queue
        _.each(_.keys($rootScope.questions), function (qid) {

          var watchResponses = function (newValue, oldValue) {
            if (oldValue === newValue) {
              return;
            }

            queue.responses[qid] = newValue;

            localStorage['queue-' + answerKey] = JSON.stringify(queue);
          };


          $rootScope.$watchCollection("responses['" + qid + "']", watchResponses);
          // Add equality watch for responses: needed to check for changes in examples
          $rootScope.$watch("responses['" + qid + "']", watchResponses, true);

          var watchNotes = function (newValue, oldValue) {
            if (oldValue === newValue) {
              return;
            }

            var sectionid = $rootScope.questions[qid].sectionid;

            $rootScope.countNotes(sectionid);

            // Only queue notes with created, deleted, saveEdited flags
            queue.notes[qid] = _.filter(newValue, function (v) {
              return v.create || v.deleted || v.saveEdited || v.saveResolved
            });

            if (_.isEmpty(queue.notes[qid])) {
              delete queue.notes[qid];
            }

            localStorage['queue-' + answerKey] = JSON.stringify(queue);
          }

          // Also watch for changes in notes collections
          $rootScope.$watchCollection("notes['" + qid + "']", watchNotes);
          $rootScope.$watch("notes['" + qid + "']", watchNotes, true);

        });

        //
        // Manage updating the answersheet
        //

        // Keep timers for processes here, cancelling pending changes to an update process
        // when newer changes have occured
        var processQueue = {
          responses: {},
          notes: {},
          uploads: {}
        };

        var uploadCallback = function () {
          if (uploadCb) {
            uploadCb();
            uploadCb = null
          }
        }

        var handleResourceError = function () {
          $rootScope.status = {
            error: true,
            message: "Error handling resource. Please check your connection, reload and try again"
          };
        }


        // Write data to the Answer sheet. If this is called with a write in progress,
        // the values are queued for the next write.
        write = function (cb) {
          if (cb) {
            uploadCb = cb;
          }
          var size = 0;

          // Process a queue for the three sections
          _.each(['responses', 'notes', 'uploads'], function (section) {
            // Don't save question responses made by non-researchers
            if (section == 'responses' && $rootScope.commentOnly) {
              return;
            }
            _.each(queue[section], function (response, qid) {
              var q = queue[section];
              var pq = processQueue[section];

              var links = $rootScope.links[section];
              var values = $rootScope[section][qid];

              // Block the queue for this question. If there are further changes
              // while this is saving, they will be picked up in the next round
              // after the original process returns.
              if (pq[qid]) {
                return;
              }

              if (section == 'uploads') {
                _.each(queue[section], function (upload, iterator) {
                  if (upload && upload.updateMe) {
                    var promise = gs.updateUpload($rootScope.answerSheets.Resources, {
                      id: upload.id,
                      title: upload.title
                    });
                    promise.then(function (row) {
                      $rootScope.uploads[upload.id] = row
                      uploadCallback()
                    }, handleResourceError);
                  } else if (upload && upload.deleteMe) {
                    var promise = gs.deleteUpload($rootScope.answerSheets.Resources, upload.id);
                    promise.then(function () {
                      if ($rootScope.uploads[upload.id]) {
                        delete $rootScope.uploads[upload.id]
                      }
                      uploadCallback()
                    }, handleResourceError)

                  } else if (upload && !upload.uploaded) {
                    var newUpload = _.extend({}, {
                      title: upload.title,
                      filename: upload.name,
                      thumbnail: upload.thumbnailLink,
                      url: upload.webViewLink ? upload.webViewLink : upload.url,
                      id: upload.id,
                    })
                    var promise = gs.insertRow($rootScope.answerSheets.Resources, newUpload);
                    promise.then(function (row) {
                      row.uploaded = true
                      $rootScope.uploads[row.id] = row
                      uploadCallback()
                    }, handleResourceError);

                    pq[upload.id] = promise;
                    upload.uploaded = true

                  }

                });

              } else if (section == 'responses') {
                // Build the record
                var record = $.extend({}, {
                  response: values.response,
                  justification: values.justification,
                  confidence: values.confidence,
                  privatenotes: values.privatenotes
                }, {
                  questionid: qid
                });
                // Copy over any supporting information
                // @TODO: read number of supporting columns from answer sheet!
                for (var i = 0; i < 10; i++) {
                  if (values['supporting' + i]) {
                    record['supporting' + i] = values['supporting' + i];
                  }
                }

                // Munge examples from model structure
                // @TODO: read number of example columns from answer sheet!
                for (var i = 0; i < 5; i++) {
                  if (values.example && i in values.example) {
                    var example = values.example[i];
                    var ex = _.extend({}, {
                      url: '',
                      text: ''
                    }, example);

                    if (ex.url && ex.title) {
                      // Store uploaded links as markdown-style
                      record['example' + i] = '[' + ex.title.replace(']', '\]') + '](' + ex.url + ')';
                    }
                    else if (ex.url) {
                      record['example' + i] = ex.url;
                    }
                    else if (ex.title) {
                      record['example' + i] = ex.title;
                    }
                  } else {
                    // As per the Sheets API, an empty cell is represented by an empty string
                    record['example' + i] = '';
                  }
                };

                var promise;

                if (links[qid]) {
                  promise = gs.updateRow(links[qid].edit, record);
                }
                else {
                  promise = gs.insertRow($rootScope.answerSheets.Answers, record);
                }

                promise.then(function (row) {
                  links[qid] = row[':links'];
                });

                pq[qid] = promise;
              }
              else if (section == 'notes') {
                // Add created notes
                _.each(_.filter(values, function (v) { return v.create && !v.deleted; }), function (note) {
                  var record = {
                    questionid: note.questionid,
                    date: new Date().format(),
                    party: $rootScope.participant,
                    field: note.field,
                    note: note.note
                  };

                  var promise = gs.insertRow($rootScope.answerSheets.Notes, record);

                  promise.then(function (row) {
                    note[':links'] = row[':links'];

                    delete note.create;
                    return row;
                  });

                  pq[qid] = promise;
                });

                // Update edited notes
                _.each(_.filter(values, function (v) { return !v.create && !v.deleted && (v.saveEdited || v.saveResolved); }), function (note) {
                  var record = {
                    questionid: note.questionid,
                    date: note.date,
                    party: note.party,
                    field: note.field,
                    note: note.note,
                    edited: note.edited,
                    resolved: note.resolved
                  };

                  if (note.saveEdited) {
                    record.edited = new Date().format();
                  }
                  else if (note.saveResolved) {
                    record.resolved = new Date().format();
                  }

                  var promise = gs.updateRow(note[':links'].edit, record);

                  promise.then(function (row) {
                    if ($rootScope.forceReadOnly) {
                      $rootScope.readOnly = true;
                    }

                    if ($rootScope.forceReadOnly) {
                      $rootScope.readOnly = true;
                    }

                    delete note.saveEdited;
                    delete note.saveResolved;

                    return row;
                  });

                  pq[qid] = promise;
                });

                // Clear deleted notes
                _.each(_.filter(values, function (v) { return v.deleted; }), function (note) {
                  var complete = function (row) {
                    // Remove deleted notes from model
                    $rootScope.notes[qid] = _.filter($rootScope.notes[qid], function (v) {
                      return !v.deleted;
                    });

                    return row;
                  }

                  // Delete from answer sheet if it exists there
                  if (note[':links']) {
                    pq[qid] = gs.deleteRow(note[':links'].edit, qid).then(complete, complete);
                  }
                  else {
                    complete({ id: qid });
                  }
                });
              }

              // No updates
              if (!pq[qid]) {
                delete q[qid];
                localStorage['queue-' + answerKey] = JSON.stringify(queue);
                return;
              }

              size++;

              pq[qid].values = _.clone(q[qid]);

              pq[qid].then(function (row) {
                var qid = row.questionid || row.id;
                size--;

                if (size == 0) {
                  $rootScope.status = {
                    message: "Last saved " + new Date().format(),
                    success: true,
                    clear: 3000
                  };
                }

                // If the values have changed, then let this run again, otherwise
                // consider this value saved
                if (!pq[qid] || _.isEqual(q[qid], pq[qid].values)) {
                  delete q[qid];
                }

                delete pq[qid];

                localStorage['queue-' + answerKey] = JSON.stringify(queue);
              }, function (message) {
                $rootScope.status = {
                  error: true,
                  message: "Failed to save changes. Please reload to continue"
                };
              });
            });
          });

          if (size) {
            // Update the lock
            $rootScope.lockSurvey();

            $rootScope.status = {
              saving: size
            }
          }
        }

        // Try to save every ten seconds.
        $interval(function () {
          // Don't bother if:
          if ($rootScope.status.locked || // Locked
            $rootScope.status.error || // An error occured
            $rootScope.readOnly || // The survey is read-only
            $rootScope.anonymous) // The survey is anonymous
            return;

          // Also don't bother if there's nothing to save
          if (_.isEmpty(queue.notes) && _.isEmpty(queue.responses) && _.isEmpty(queue.uploads))
            return;

          var q = $q.defer();

          // Check the lock before making any changes
          loader.loadControlValues().then(function () {
            if ($rootScope.control['Last Access'] == $rootScope.lockString) {
              q.resolve();
            }
            else {
              // Someone's change it since we last looked at it. Force the user to reload.
              var matches = $rootScope.control['Last Access'] && $rootScope.control['Last Access'].match(/^(\d+)\|(.+)$/);

              if (matches) {
                // Notify user that someone else has taken over the survey and lock out
                $rootScope.status = {
                  locked: {
                    time: matches[1],
                    role: matches[2],
                    takenover: true
                  },
                  message: "Survey has been taken over."
                };

                q.reject();
              }
            }
          }, function () {
            $rootScope.status = {
              error: true,
              message: "Failed to save changes. Please reload to continue"
            };
          });

          q.promise.then(write);
        }, 10000);

      }, function (message) {
        $rootScope.error = message;
        $rootScope.loading = false;
        $rootScope.readOnly = true;
      });

    });

		/**
		 * Accept a boolean or a string,
		 *
		 * If boolean, toggle "Complete" popup
		 * If string, complete the survey by moving it to the state specified, and
		 * make the survey readOnly.
		 */
    $rootScope.complete = function (completing) {
      if (typeof completing == "boolean") {
        $rootScope.completing = completing;

        if ($rootScope.participant == 'Coordinator') {
          $rootScope.nextStates = [$rootScope.statusFlow[$rootScope.surveyStatus].nextStates[0]];

          _.each(_.keys($rootScope.statusFlow), function (key) {
            if (key != $rootScope.nextStates[0] && key != $rootScope.surveyStatus) {
              $rootScope.nextStates.push(key);
            }
          });
        }
        else {
          $rootScope.nextStates = $rootScope.statusFlow[$rootScope.surveyStatus].nextStates;
        }
      }
      else if (typeof completing == "string" && $rootScope.completing) {
        var status = $rootScope.control['Status'];

        if (!$rootScope.statusFlow[status]) {
          $rootScope.status = {
            message: "The survey is an invalid state and can not be submitted. Please contact your survey coordinator to remedy this.",
            error: true,
            clear: 10000
          };

          $rootScope.completing = false;
          return;
        }

        $rootScope.status = {
          message: "Submitting survey for the next step..."
        };

        var state = $rootScope.statusFlow[status];

        gs.updateRow($rootScope.links.control['Status'].edit, {
          field: 'Status',
          value: completing
        })
          .then(function () {
            $rootScope.status = {
              message: "Submitted!",
              readOnly: "This survey is now read-only.",
              success: true
            }
          });

        $rootScope.unlockSurvey();
        $rootScope.readOnly = true;
        $rootScope.completing = false;
        $rootScope.surveyStatus = completing;
      }
    }

    $rootScope.$watch('surveyStatus', function (status, oldStatus) {
      if (status === oldStatus) {
        return;
      }

      var state = $rootScope.statusFlow[status];

      if (!state) {
        $rootScope.status = {
          message: "Invalid status: `" + $rootScope.surveyStatus + "`. Please contact the Survey Coordinator to resolve this issue.",
          error: true
        }

        return;
      }
    });
  }])

  // Create a rail exactly the size of the sections menu
  .directive('withRail', ['$timeout', function ($timeout) {
    return {
      link: function ($scope, element, attrs) {
        $scope.$on('loaded', function () {
          $timeout(function () {
            var $sections = $('#sections');
            var $ul = $sections.find('ul');

            $sections.width($ul.width());

            $(element).css('padding-left', $ul.width());
          }, 0, false);
        });
      }
    }
  }])

  // Set sectionAnswers and sectionQuestions scope variables for a particular
  // section when a response is changed
  .directive('updateOnResponse', ['$timeout', function ($timeout) {
    return {
      link: function ($scope, element, attrs) {
        $scope.$on('response-updated', function () {
          $scope.sectionAnswers = [];
          $scope.sectionQuestions = _.filter($scope.questions, function (q) {
            if (q.sectionid == $scope.sectionid) {
              if ($scope.responses[q.questionid].response != undefined && $scope.responses[q.questionid].response !== '') {
                $scope.sectionAnswers.push($scope.responses[q.questionid]);
              }

              return true;
            }

            return false;
          });
        });
      }
    }
  }])

  // Fade out an element based on 'clear' property of argument
  .directive('fadeOn', ['$timeout', function ($timeout) {
    return {
      link: function ($scope, element, attrs) {
        var timeoutPromise;

        if (!$scope.$eval(attrs.fadeOn)) {
          element.addClass('ng-hide');
        }

        $scope.$watch(attrs.fadeOn, function (val) {
          if (val) {
            element.removeClass('ng-hide');
          }

          $timeout.cancel(timeoutPromise);

          if (!val) {
            return;
          }

          if (val.clear) {
            timeoutPromise = $timeout(function () {
              element.fadeOut(function () {
                element.addClass('ng-hide');
                element.css('display', '');
              });
            }, val.clear, 0)
          }
        }, true);
      }
    }
  }])

  // Attach notes to a question. Evaluate argument then evaluate against $scope
  .directive('notes', ['$rootScope', function ($rootScope) {
    return {
      templateUrl: 'tpl/notes.html',
      restrict: 'E',
      scope: {},

      link: function ($scope, element, attrs) {
        // Determine the expression within 'response' that refers to the field being noted
        $scope.field = $scope.$eval(attrs.field);

        $rootScope.$watch('participant', function (value) {
          $scope.participant = value;
        });

        // Import scope variables
        $scope.question = $scope.$parent.question;

        var refreshNotes = function (newValue, oldValue) {
          $scope.notes = [];
          $scope.threads = {};
          $scope.threadOrder = [];
          var resolved = '';

          _.chain($rootScope.notes[$scope.question.questionid])
            .where({ field: $scope.field })
            .each(function (note) {
              if (note.resolved) {
                if ($scope.threadOrder.indexOf(note.resolved) === -1) {
                  $scope.threadOrder.push(note.resolved);
                  $scope.threads[note.resolved] = [];
                }

                $scope.threads[note.resolved].push(note);
              }
              else if (!note.deleted) {
                $scope.notes.push(note);
              }
            });
        }

        refreshNotes();

        $rootScope.$watch('notes["' + $scope.question.questionid + '"]', refreshNotes, true);
        $rootScope.$watchCollection('notes["' + $scope.question.questionid + '"]', refreshNotes, true);

        $scope.addNote = function () {
          if (!$scope.newNote || $scope.newNote.match(/^\s*$/)) {
            return;
          }

          $rootScope.notes[$scope.question.questionid].push({
            questionid: $scope.question.questionid,
            party: $rootScope.participant,
            field: $scope.field,
            note: $scope.newNote,
            create: true
          });

          $scope.addingNote = false;
          $scope.newNote = '';
        }

        $scope.$watch('addingNote', function (addingNote) {
          if ($scope.editing) {
            $scope.editing.editing = false;
            $scope.editing = false;
          }

          if (addingNote) {
            element.find('textarea').focus();
          }
        });

        $scope.edit = function (index) {
          if ($scope.editing) {
            $scope.editing.editing = false;
          }

          var note = $scope.editing = $scope.notes[index];

          note.editValue = $scope.notes[index].note;
          note.editing = true;
        }

        $scope.update = function (index) {
          var note = $scope.notes[index];

          note.note = note.editValue;
          note.editing = false;
          note.saveEdited = true;
          note.edited = new Date().format();
        }

        $scope.$watch('editing', function (editing) {
          if (editing) {
            $scope.addingNote = false;
          }
        });

        $scope.resolve = function (notes) {
          var timestamp = new Date().format();

          _.each(notes, function (note) {
            note.saveResolved = true;
            note.resolved = timestamp;
          });
        }

        $scope.delete = function (index) {
          $scope.notes.splice(index, 1)[0].deleted = true;
        }

        element.addClass('notable');

        $scope.$watch('opened', function (opened) {
          $(document).trigger('close-notes');

          if (opened) {
            function cancel() {
              $scope.opened = false;
              $(document).off('close-notes', cancel);
            }
            $(document).on('close-notes', cancel);
          }
        });
      }
    }
  }])

  // Drive a "sum" type question, which has for a value the sum of all
  // of its subquestion's responses
  .directive('sumQuestion', ['$rootScope', function ($rootScope) {
    return {
      link: function ($scope, element, attrs) {
        var question = $scope.$eval(attrs.sumQuestion);

        // Update response when any child value changes
        var update = function () {
          function computeSum(questions) {
            var sum = 0;

            angular.forEach(questions, function (q) {
              var number = parseInt($scope.responses[q.questionid].response);

              if (!isNaN(number)) {
                sum += number;
              }

              if (q.subquestions && q.subquestions.length) {
                sum += computeSum(q.subquestions);
              }
            });

            return sum;
          }

          $rootScope.responses[question.questionid].response = computeSum(question.subquestions);
        }

        // Listen on all sub-question responses (and their subquestions)
        var listenRecursively = function (questions) {
          angular.forEach(questions, function (question) {
            $scope.$watch('responses["' + question.questionid + '"].response', update);
          });
        }

        listenRecursively(question.subquestions);
      }
    }
  }])


  // For managing uploaded resources
  .directive('resourceManager', ['$rootScope', '$timeout', function ($rootScope, $timeout) {
    return {
      restrict: 'E',
      templateUrl: 'tpl/resource-manager.html',
      scope: {},
      link: function ($scope, element, attrs) {

        $scope.elementId = 'el-' + Math.random().toString().split('.')[1]
        $scope.areResourcesVisible = false;

        $scope.shouldHideExisting = true;
        $scope.openResources = function () {
          $scope.areResourcesVisible = true
        }
        $scope.closeResources = function () {
          $scope.areResourcesVisible = false
        }
        $rootScope.$watchCollection('uploads', function () {
          $scope.uploads = Object.values($rootScope.uploads)
        })
        $scope.$on('close-resources', function () {
          $scope.$apply(function () {
            $scope.areResourcesVisible = false
          })
        })
      }
    }
  }])

  // A field for specifying a URL or a uploaded file
  .directive('uploadableUrl', ['$rootScope', '$http', '$q', function ($rootScope, $http, $q) {
    return {
      templateUrl: 'tpl/uploadable-url.html',
      restrict: 'E',
      replace: true,
      scope: {
        model: '=',
        isResourceManager: '=manager'
      },



      link: function ($scope, element, attrs) {
        $scope.placeholder = attrs.placeholder ? $scope.$eval(attrs.placeholder) : '';
        $scope.$watch(attrs.placeholder, function (newValue, oldValue) {
          if (oldValue !== newValue) {
            $scope.placeholder = $scope.$eval(attrs.placeholder);
          }
        });


        $scope.onChangeOnUpdateMessageHandler = function (onChangeMessage, onUpdateMessage, cb) {
          $rootScope.status = {
            message: onChangeMessage,
            clear: 10000
          };
          write(function () {
            $rootScope.status = {
              message: onUpdateMessage + " " + new Date().format(),
              success: true,
              clear: 3000
            };
            if (cb) {
              cb();
            }
          })
        }

        $scope.editSaving = false;
        $scope.titleChanged = false
        $scope.getOriginalTitle = function () {
          if (!$scope.originalTitle) {
            $scope.originalTitle = $scope.model.title;
          }
        }
        $scope.handleChangedTitle = function () {
          if ($scope.model.title != $scope.originalTitle) {
            $scope.titleChanged = true;
          } else {
            $scope.titleChanged = false;
          }
        }
        $scope.updateUpload = function (model) {
          $scope.editSaving = true;
          model.updateMe = true
          $rootScope.queuedUploads[model.id] = model;

          $scope.titleChanged = false
          $scope.onChangeOnUpdateMessageHandler('Saving edit', 'Title saved', function () {
            $scope.editSaving = false;
          })
        }
        $scope.onClickURLSubmit = function () {
          if ($scope.model) {
            var id = Date.now()
            $rootScope.queuedUploads[id] = {
              title: $scope.model.title,
              url: $scope.model.url,
              id: id
            }

            $scope.model.disabled = true;
            $scope.model.locked = true;

            $scope.onChangeOnUpdateMessageHandler('Saving URL', 'URL saved')
          }
        }
        $scope.onChangeUploadSelect = function () {
          if ($scope.model) {
            var currentTitle = $scope.model.title
            var category = $scope.model.category
            $scope.model = _.clone($scope.uploads.model);
            if (currentTitle) $scope.model.title = currentTitle
            $scope.model.disabled = true;
            $scope.model.locked = true;
            $scope.model.category = category;
            $scope.onChangeOnUpdateMessageHandler('Saving Upload', 'Upload saved')
          }

        }
        var uploadsList = Object.values($rootScope.uploads)
        $scope.uploads = {
          availableOptions: uploadsList,
          model: { id: 'choose', title: 'Please choose a file' }
        };

        $rootScope.$watchCollection('uploads', function () {
          $scope.uploads = {
            availableOptions: Object.values($rootScope.uploads),
            model: { id: 'choose', title: 'Please choose a file' }
          };
        })

        if ($scope.model.url) {
          $scope.model.uploaded = true;
        }

        $scope.$parent.$watch(attrs.ngDisabled, function (val) {
          $scope.disabled = val;
        });

        $scope.upload = function (upload) {
          var $scope = $(upload).scope();

          if ($scope.uploading) {
            return;
          }



          var $index = $(upload).parents('.flexible-list-item').index();

          var file = upload.files[0];
          $scope.uploaded = false;

          if (!file) {
            return;
          }
          $scope.uploadState = "Uploading...";

          $rootScope.status = {
            message: 'Uploading...',
            clear: 10000
          };

          var fd = new FormData();
          fd.append('file', file);

          $http({
            method: 'POST',
            url: '/google-drive.php',
            params: {
              action: 'upload',
              filename: file.name,
              country: $rootScope.country,
              sheet: $rootScope.answerSheets.Control.key
            },
            headers: {
              'Content-Type': undefined
            },
            transformRequest: angular.identity,
            data: fd
          }).then(
            function uploadSuccess(results) {
              $scope.uploading = false;
              $scope.uploadState = "Uploaded";



              $scope.model.fileId = results.data.id;
              $scope.model.url = results.data.webViewLink;
              $scope.model.fileName = results.data.name;
              $scope.model.locked = true;
              $scope.model.uploaded = true;

              // Grant Permissions
              var userPermPromise = $http({
                method: 'GET',
                url: '/google-drive.php',
                params: {
                  action: 'grantPerms',
                  file_id: results.data.id,
                  email: $rootScope.userEmail
                },
              });
              var coordinatorEmail = $rootScope.control['Coordinator Email'];
              var coordinatorPermPromise = $http({
                method: 'GET',
                url: '/google-drive.php',
                params: {
                  action: 'grantPerms',
                  file_id: results.data.id,
                  email: coordinatorEmail
                },
              });

              $q.all([userPermPromise, coordinatorPermPromise]).then(function () {
                results.data.title = $scope.model.title
                $rootScope.queuedUploads[results.data.id] = results.data;
              }, function () {
                $scope.uploadState = "Failed setting upload permissions! Try again.";
                $scope.model.locked = false;
                $scope.model.uploaded = false;
              });

            }, function uploadFailed(data, status, headers, config) {
              $scope.uploadState = "Upload Failed! Try again.";
              $scope.model.locked = false;
              $scope.model.uploaded = false;
            }
          );
        }
      }
    }
  }])

  // Allow for insert/update/delete operations on a list of text inputs
  .directive('flexibleList', ['$rootScope', function ($rootScope) {
    return {
      templateUrl: 'tpl/flexible-list.html',
      restrict: 'E',
      scope: {},

      link: function ($scope, element, attrs) {
        $scope.atLeast = parseInt(attrs.atLeast);


        var load = function (newValue) {

          if (newValue) {
            var lockedValue = []


            if ($scope.isResourceManager) {
              lockedValue = newValue.map(function (file) {
                var upload = _.extend(file, {
                  category: file.id[1] === 5 ? 'url' : 'file',
                  disabled: true,
                  locked: true,
                })
                return upload
              })
              if ($scope.currentlyEditing) {
                lockedValue.push($scope.currentlyEditing)
                $scope.currentlyEditing = false
              }
            } else {
              lockedValue = newValue
            }
            $scope.list = lockedValue
          }

          if (!$scope.list) {
            $scope.list = [];
          }

          if ($scope.atLeast && $scope.list && $scope.list.length < $scope.atLeast) {
            for (var i = 0; i < $scope.atLeast; i++) {
              $scope.list.push({});
            }
          }
          $scope.counter = $scope.list.length;
        }

        $scope.isResourceManager = $scope.$parent.shouldHideExisting ? true : false;

        $scope.$parent.$watch(attrs.collection, load, true);

        $scope.deleteItem = function (index) {
          $scope.counter--;
          // Remove from list
          var deletedId = $scope.list[index].id
          $scope.list.splice(index, 1)
          // If we're in resource manager, delete the upload
          if ($scope.isResourceManager) {
            if (deletedId) {
              $rootScope.queuedUploads[deletedId] = _.extend($rootScope.uploads[deletedId], {
                deleteMe: true
              })
              // optimistically remove upload
              delete $rootScope.uploads[deletedId]
            }
            $rootScope.status = {
              message: "Deleting",
              clear: 10000
            };
            write(function () {
              $rootScope.status = {
                message: "Resource deleted " + new Date().format(),
                success: true,
                clear: 3000
              };
            })
          }
        }

        if (!$scope.isResourceManager) {
          $rootScope.$watchCollection('uploads', function () {
            $scope.uploads = Object.values($rootScope.uploads)
          })
        }

        $scope.$watch('list', function (newValue) {
          $scope.$parent.collection = newValue;
        });

        $scope.$parent.$watch(attrs.ngDisabled, function (disabled) {
          $scope.disabled = disabled;
        });

        $scope.add = function (category) {
          $scope.counter++
          var newResource = {
            category: category
          }
          $scope.list.push(newResource);
          $scope.currentlyEditing = newResource
        }
      }
    }
  }])

  // Fancy select box
  .directive('fancySelect', ['$rootScope', '$timeout', function ($rootScope, $timeout) {
    return {
      restrict: 'E',
      templateUrl: 'tpl/fancy-dropdown.html',
      replace: true,
      compile: function (element, attrs) {
        var $select = element.find('select');
        var selectedIndex = -1;

        _.each(_.clone(element[0].attributes), function (attr) {
          if (attr.name != 'class') {
            $select.attr(attr.name, attr.value);
            element.removeAttr(attr.name);
          }
        });

        if (attrs.withNull) {
          $select.append($('<option value="">').text(attrs.withNull));
          selectedIndex = 0;
        }

        var disabled = attrs.ngDisabled;

        return function ($scope, element, attrs, transclude) {
          var $select = element.find('select');
          var $options = element.find('.fancy-select-options');

          $rootScope.$watch(disabled, function (val) {
            $scope.disabled = val;
          });
          $scope.selectedIndex = selectedIndex;

          // Keep a local model containing the select's <option>s
          //
          // The angular code for managing the select <option>s is turbly
          // complicated and it's best to just avoid having to use it at all,
          // use the DOM to notify of changes instead
          function update() {
            $scope.items = [];

            $select.find('option').each(function () {
              $scope.items.push(this.textContent);
            });

            // Measure the width of the widest item and set the drop-down's
            // width to that
            $timeout(function () {
              var $clone = $('<div class="fancy-select">');

              $clone.html(element.html());
              $clone.css('width', '');

              var $dropdown = $clone.find('.fancy-select-options');

              $clone.css({ visibility: 'hidden', position: 'absolute', top: 0 });
              $dropdown.removeClass('ng-hide').css('display', 'block');
              $('body').append($clone);
              element.css({ width: $dropdown.outerWidth() });
              $clone.remove();
            }, 0);

            $scope.selectedIndex = $select[0].selectedIndex;
          }

          var lastOptions = [];

          $scope.$parent.$watch(function () {
            var options = _.map($select[0].options, function (option) {
              return [option.value, option.textContent];
            });

            if (!_.isEqual(options, lastOptions) || $select[0].selectedIndex != $scope.selectedIndex) {
              update();
              lastOptions = options;
            }
          });

          update();

          // Use the DOM to notify angular by just changing the value
          $scope.select = function (index) {
            $timeout(function () {
              $select[0].selectedIndex = index;
              $select.trigger('change');
            }, 0);

            $scope.opened = false;
            $scope.selectedIndex = index;
          }

          $scope.$on('close-popups', function () {
            if ($scope.opened) {
              $scope.opened = false;
            }
          });
        }
      }
    }
  }])

  // Modal controlled by a model variable
  .directive('modal', ['$rootScope', '$timeout', function ($rootScope, $timeout) {
    return {
      restrict: 'E',
      templateUrl: 'tpl/modal.html',
      transclude: true,
      replace: true,
      scope: true,
      link: function ($scope, element, attrs) {
        $scope.$watch(attrs.model, function (val) {
          $scope.showing = val;
        });

        if (attrs.cancel) {
          $scope.cancel = function () {
            $scope.$eval(attrs.cancel);
          }
        }
      }
    }
  }])


  // Initialize this module
  .run(['$rootScope', '$q', 'spreadsheets', function ($rootScope, $q, gs) {
    $rootScope.readOnly = true;
    $rootScope.loading = true;

    // Broadcast to all scopes when popups or notes should be closed
    // because we clicked on the document

    document.onkeydown = function (evt) {
      evt = evt || window.event;
      var isEscape = false;
      if ("key" in evt) {
        isEscape = (evt.key === "Escape" || evt.key === "Esc");
      } else {
        isEscape = (evt.keyCode === 27);
      }
      if (isEscape) {
        $(document).trigger('close-notes');
        $rootScope.$broadcast('close-popups');
        $rootScope.$broadcast('close-resources');
      }
    };

    $(document).on('click', function (ev) {
      if ($(ev.target).closest('.notes, .open-notes, .cancel-note, .save-note, .note-edit, .note-resolve').length == 0) {
        $(document).trigger('close-notes');
      }
      if ($(ev.target).closest('.fancy-select').length == 0) {
        $rootScope.$broadcast('close-popups');
      }
    });

    $(document).on('click', '.helplink a', function (ev) {
      ev.preventDefault();
      $('#helplink-content').addClass('open')
        .find('iframe').attr('src', $(this).attr('href'));

    });

    $(document).on('click', '#helplink-content .close', function (ev) {
      ev.preventDefault();
      $('#helplink-content').removeClass('open')
        .find('iframe').attr('src', '');
    });

    window.init = function () {
      gapi.load('auth2', function () {
        auth2 = gapi.auth2.init({
          client_id: CLIENT_ID,
          fetch_basic_profile: true,
          scope: 'profile'
        });

        // Listen for sign-in state changes.
        // auth2.isSignedIn.listen(signinChanged);

        // Listen for changes to current user.
        // auth2.currentUser.listen(userChanged);

        // Sign in the user if they are currently signed in.

        auth2.then(function () {
          $rootScope.showSignin = true;
          $rootScope.$digest();
          gapi.signin2.render('signin2-button', {
            'scope': 'profile',
            'width': 220,
            'height': 50,
            'longtitle': true,
            'theme': 'dark',
            'onSuccess': signinSuccess,
            'onFailure': signinFailure
          });
        });
      });
    };


    window.signinChanged = function (val) {
      if (val) {
        showSurvey();
      } else {
        showSignin();
      }
    };

    window.userChanged = function (user) {
      if (user.isSignedIn()) {
        showSurvey();
      } else {
        showSignin();
      }
    };


    window.signinSuccess = function () {
      var user = gapi.auth2.getAuthInstance().currentUser.get();
      $rootScope.userEmail = user.getBasicProfile().getEmail().toLowerCase();
      if ($rootScope.loading) {
        return;
      }
      $rootScope.showSignin = false;
      $rootScope.loading = "Loading Survey...";
      $rootScope.status = {
        message: "Loading..."
      };
      $rootScope.$broadcast('load-survey');
    }

    window.signinFailure = function () {
      // Do nothing
    }

    function safeInit() {
      if (!gapi) {
        setTimeout(safeInit, 1000)
      } else {
        window.init()
      }
    }
    safeInit()
  }]);

