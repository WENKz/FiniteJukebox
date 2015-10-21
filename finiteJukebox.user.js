// ==UserScript==
// @name         Finite Jukebox
// @namespace    https://github.com/kwongius/
// @homepageURL  https://github.com/kwongius/FiniteJukebox
// @version      0.1.1
// @description  Allows recording audio from Infinite Jukebox to a wav file.
// @author       Kevin Wong
// @match        *://labs.echonest.com/Uploader/index.html?trid=*
// @grant        GM_addStyle
// @require      https://raw.githubusercontent.com/eligrey/FileSaver.js/master/FileSaver.min.js
// ==/UserScript==


// File saving makes use of FileSaver.js by Eli Grey
// https://github.com/eligrey/FileSaver.js/
//
// Wav Export based on recorder.js by Matt Diamond
// https://github.com/mattdiamond/Recorderjs
//

GM_addStyle("#finite_jukebox_buttons > .cbut { margin: 2px; } ");

(function() {

    // Name of the track. Used for the filename when downloading.
    var trackTitle;

    // Modified from the original Recorder.js by Matt Diamond
    // https://github.com/mattdiamond/Recorderjs
    var recorder = function() {

        var MAX_RECORDER_LENGTH = 60 * 60 * 3; // 3 Hours.

        var recLength = 0;
        var sampleRate = null;
        var exportCallback = null;

        var reachedMax = false;

        // Create a worker that handles audio buffering and exporting
        var worker = (function(){

            var workerFunc = function() {

                var recLength = 0;
                var recBuffers = null;
                var sampleRate;
                var numChannels;

                this.onmessage = function(e) {
                    switch (e.data.command) {
                        case "recordQuantum":
                            recordQuantum(e.data.config, e.data.buffer);
                            break;
                        case "exportWAV":
                            exportWAV(e.data.type);
                            break;
                        case "reset":
                            clear();
                            break;
                    }
                };

                function prepare(config) {
                    if (recBuffers != null) {
                        return;
                    }

                    // Reset state
                    clear();
                    sampleRate = config.sampleRate;
                    numChannels = config.numberOfChannels;

                    // Setup initial buffer arrays
                    recBuffers = [];
                    for (var channel = 0; channel < numChannels; channel++) {
                        recBuffers.push([]);
                    }
                }

                function recordQuantum(config, buffer) {
                    prepare(config);

                    for (var channel = 0; channel < numChannels; channel++) {
                        recBuffers[channel].push(buffer[channel]);
                    }
                    recLength += buffer[0].length;
                }

                function exportWAV(type){
                    var buffers = [];
                    for (var channel = 0; channel < numChannels; channel++){
                        buffers.push(mergeBuffers(recBuffers[channel], recLength));
                    }
                    if (numChannels === 2){
                        var interleaved = interleave(buffers[0], buffers[1]);
                    } else {
                        var interleaved = buffers[0];
                    }
                    var dataview = encodeWAV(interleaved);
                    var audioBlob = new Blob([dataview], { type: type });

                    this.postMessage({
                        command : "exportComplete",
                        audioBlob : audioBlob
                    });
                }

                function mergeBuffers(recBuffers, recLength){
                    var result = new Float32Array(recLength);
                    var offset = 0;
                    for (var i = 0; i < recBuffers.length; i++){
                        result.set(recBuffers[i], offset);
                        offset += recBuffers[i].length;
                    }
                    return result;
                }

                function interleave(inputL, inputR){
                    var length = inputL.length + inputR.length;
                    var result = new Float32Array(length);

                    var index = 0,
                        inputIndex = 0;

                    while (index < length){
                        result[index++] = inputL[inputIndex];
                        result[index++] = inputR[inputIndex];
                        inputIndex++;
                    }
                    return result;
                }

                function floatTo16BitPCM(output, offset, input){
                    for (var i = 0; i < input.length; i++, offset+=2){
                        var s = Math.max(-1, Math.min(1, input[i]));
                        output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
                    }
                }

                function writeString(view, offset, string){
                    for (var i = 0; i < string.length; i++){
                        view.setUint8(offset + i, string.charCodeAt(i));
                    }
                }

                function encodeWAV(samples){
                    var buffer = new ArrayBuffer(44 + samples.length * 2);
                    var view = new DataView(buffer);

                    /* RIFF identifier */
                    writeString(view, 0, 'RIFF');
                    /* RIFF chunk length */
                    view.setUint32(4, 36 + samples.length * 2, true);
                    /* RIFF type */
                    writeString(view, 8, 'WAVE');
                    /* format chunk identifier */
                    writeString(view, 12, 'fmt ');
                    /* format chunk length */
                    view.setUint32(16, 16, true);
                    /* sample format (raw) */
                    view.setUint16(20, 1, true);
                    /* channel count */
                    view.setUint16(22, numChannels, true);
                    /* sample rate */
                    view.setUint32(24, sampleRate, true);
                    /* byte rate (sample rate * block align) */
                    view.setUint32(28, sampleRate * 4, true);
                    /* block align (channel count * bytes per sample) */
                    view.setUint16(32, numChannels * 2, true);
                    /* bits per sample */
                    view.setUint16(34, 16, true);
                    /* data chunk identifier */
                    writeString(view, 36, 'data');
                    /* data chunk length */
                    view.setUint32(40, samples.length * 2, true);

                    floatTo16BitPCM(view, 44, samples);

                    return view;
                }

                function clear() {
                    recLength = 0;
                    recBuffers = null;

                    this.maxDuration = null;
                    this.recording = false;
                }
            }

            // Build a worker blob from a function body
            var blobURL = URL.createObjectURL(new Blob(["(",
                workerFunc.toString(),
            ")()"], {type : "application/javascript" }));

            var w = new Worker(blobURL);
            URL.revokeObjectURL(blobURL);

            return w;
        })();

        ////////////////////////////////////////////////////////////////////////////
        ////////////////////////////////////////////////////////////////////////////

        function recordQuantum(q, finish) {
            // Don't record the quantum if we're not supposed to be recording
            if (!this.isRecording()) {
                return;
            }

            if (sampleRate == null) {
                // Set the sample rate
                sampleRate = q.track.buffer.sampleRate;
            }

            // Calculate the indices of the samples to insert
            var samples = Math.floor(q.duration * sampleRate);
            var start = Math.floor(q.start * sampleRate);
            var end = start + samples;

            var trackBuffer = q.track.buffer;

            // If the quantum will push the duration over the limit, add the rest of the file
            var newDuration = this.getDuration() + q.duration;
            if (newDuration > MAX_RECORDER_LENGTH || (this.maxDuration != null && newDuration > this.maxDuration)) {
                // add all the samples from the start of the quantum to the end of the buffer
                end = trackBuffer.length;
                samples = end - start;
                reachedMax = true;
            }

            // Get the raw samples
            var buffers = [];
            for (var channel = 0; channel < q.track.buffer.numberOfChannels; channel++) {
                buffers.push(trackBuffer.getChannelData(channel).slice(start, end));
            }

            // Post the samples to the worker
            worker.postMessage({
                command : "recordQuantum",

                config : {
                    sampleRate : q.track.buffer.sampleRate,
                    numberOfChannels : q.track.buffer.numberOfChannels
                },
                buffer : buffers
            });

            // Increment length of the recording
            recLength += samples;
        }

        function exportWAV(type, cb) {
            // save the callback
            exportCallback = cb;

            worker.postMessage({
                command : "exportWAV",
                type : type
            });
        }

        function reset() {
            recLength = 0;
            sampleRate = null;
            reachedMax = false;

            worker.postMessage({
                command : "reset"
            });
        }

        worker.onmessage = function(e) {
            switch (e.data.command) {
                case "exportComplete":

                    if (exportCallback != null) {
                        exportCallback(e.data.audioBlob);
                    }
                    exportCallback = null;
                    break;
            }
        }


        return {
            recording : false,
            maxDuration : null,

            isRecording : function() {
                return this.recording && !reachedMax;
            },

            isRecordingNormal : function() {
                return this.maxDuration == null && this.isRecording();
            },

            isRecordingTimed : function() {
                return this.maxDuration != null && this.isRecording();
            },

            startRecording : function() {
                this.recording = true;
            },
            stopRecording : function() {
                this.recording = false;
            },

            getDuration : function() {
                return recLength / sampleRate;
            },

            getRemainingDuration : function() {
                if (this.maxDuration == null) {
                    return NaN;
                }

                return Math.min(this.maxDuration, MAX_RECORDER_LENGTH) - this.getDuration();
            },

            recordQuantum : recordQuantum,
            reset : reset,
            exportWAV : exportWAV
        };
    }();


    ////////////////////////////////////////////////////////////////////////////
    // Buttons
    ////////////////////////////////////////////////////////////////////////////

    var buttonDiv = $("<div>", {id: "finite_jukebox_buttons", style: "background:#222; top:10px; right:10px; position:absolute; text-align: right; padding: 10px;"});
    buttonDiv.appendTo("body");

    var recordDiv = $("<div>");
    buttonDiv.append($("<button>", {id: "record", class: "cbut"}).html("Record"));
    buttonDiv.append($("<button>", {id: "timed_record", class: "cbut"}).html("Timed Record")).append($("<br>"));
    buttonDiv.append($("<button>", {id: "fastmode", class: "cbut"}).html("Fast Mode: OFF")).append($("<br>"));
    buttonDiv.append($("<button>", {id: "download", class: "cbut"}).html("Download"));

    // Start/Stop button. This is a default button
    $("#go").click(updateState);

    // Record button
    $("#record").click(function () {
        if (!recorder.isRecording()) {
            recorder.reset();
            startPlaying();
        }

        recorder.recording = !recorder.recording;
        updateState();
    });

    // Timed record button
    $("#timed_record").click(function() {
        if (!recorder.isRecording()) {
            recorder.reset();

            var time = prompt("Please select a duration (HH:MM:SS format)", "10:00");

            var seconds = parseSeconds(time);
            if (isNaN(seconds) || seconds <= 0) {
                alert("'" + time + "' is not a valid duration.");
                return;
            }

            recorder.maxDuration = seconds;
            startPlaying();
        }

        recorder.recording = !recorder.recording;
        updateState();
    });

    // Download button
    var exportingFile = false;
    $("#download").click(function() {
        exportingFile = true;
        updateState();

        recorder.exportWAV("audio/wav", function(audioBlob) {
            if (audioBlob == null) {
                return;
            }
            saveAs(audioBlob, (trackTitle || "infinite_jukebox") + ".wav");
            exportingFile = false;
            updateState();
        });
    });

    // fastmode button
    $("#fastmode").click(function() {
        fastMode = !fastMode;
        updateState();
    });

    $(window).on("load", function() {
        updateState();
    });

    ////////////////////////////////////////////////////////////////////////////
    // Hook Player
    ////////////////////////////////////////////////////////////////////////////

    var orig_createJRemixer = createJRemixer;

    // Update state when we are able to play, enabling buttons
    var orig_readyToPlay = readyToPlay;
    readyToPlay = function() {
        var result = orig_readyToPlay.apply(this, arguments);

        updateState();
        return result;
    }


    createJRemixer = function(context) {
        var remixer = orig_createJRemixer.apply(this, arguments);

        var orig_getPlayer = remixer.getPlayer;

        remixer.getPlayer = function() {
            var player = orig_getPlayer.apply(this, arguments);

            var orig_play = player.play;
            var orig_stop = player.stop;

            player.play = function(when, q) {
                trackTitle = trackTitle || q.track.title;
                var result = orig_play.apply(this, arguments);

                // Record each quantum
                recorder.recordQuantum(q);
                updateState();

                return result;
            }

            player.stop = function(when, q) {
                var result = orig_stop.apply(this, arguments);

                recorder.stopRecording();
                updateState();

                return result;
            }

            return player;
        }

        return remixer;
    }

    ////////////////////////////////////////////////////////////////////////////
    // Helper Methods
    ////////////////////////////////////////////////////////////////////////////
    var isPlaying = function() {
        return driver != null && driver.isRunning();
    }

    var startPlaying = function() {
        if (isPlaying()) {
            return true;
        }

        if (driver == null) {
            return false;
        }

        driver.start();
    }

    var parseSeconds = function(timeString) {
        var sections = timeString.split(":").reverse();

        if (sections.length > 3) {
            return NaN;
        }

        for (var i = 0; i < sections.length; i++) {
            if (!/^\d*$/.test(sections[i])) {
                return NaN;
            }
        }

        var seconds = 0;
        var minutes = 0;
        var hours = 0;


        if (sections.length >= 3) {
            hours = parseInt(sections[2], 10);
        }
        if (sections.length >= 2) {
            minutes = parseInt(sections[1], 10);
        }
        if (sections.length >= 1) {
            seconds = parseInt(sections[0], 10);
        }

        // Microwave style
        if (seconds >= 100 || minutes >= 100) {
            return NaN;
        }

        return seconds + minutes * 60 + hours * 3600;
    }

    var updateState = function() {

        // whether recording is in progress for the types of recordings
        var normalRecording = isPlaying() && recorder.isRecordingNormal();
        var timedRecording = isPlaying() && recorder.isRecordingTimed();
        var hasRecording = (!(isPlaying() && recorder.isRecording()) && recorder.getDuration() > 0 && !exportingFile);

        // Update button text
        var durationString;
        if (timedRecording) {
            durationString = getDurationString(recorder.getRemainingDuration());
        } else {
            durationString = getDurationString(recorder.getDuration());
        }
        if (durationString == "") {
            // non breaking space so the height of the button is ok
            durationString = "\xa0";
        }

        $("#record").text(normalRecording ? "" + durationString : "Record");
        $("#timed_record").text(timedRecording ? "" + durationString : "Timed Record");
        if (exportingFile) {
            $("#download").text("Exporting file...");
        } else {
            $("#download").text(hasRecording ? "Download " + durationString : "Download");
        }
        $("#fastmode").text("Fast Mode: " + (fastMode ? "ON" : "OFF"));

        // Enable/disable buttons as necessary
        $("#record").prop("disabled", driver == null || (recorder.isRecording() && !normalRecording));
        $("#timed_record").prop("disabled", driver == null || (recorder.isRecording() && !timedRecording));
        $("#download").prop("disabled", !hasRecording);
        $("#fastmode").prop("disabled", driver == null);
    }

    var getDurationString = function(seconds) {
        var hours = Math.floor(seconds / 3600);
        var minutes = Math.floor((seconds % 3600) / 60);
        seconds = Math.floor(seconds % 60);
        if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
            return "";
        }

        var timeString = "";
        if (hours > 0) {
            timeString += hours + ":";
        }
        timeString += (minutes < 10 ? "0" : "") + minutes + ":";
        timeString += (seconds < 10 ? "0" : "") + seconds;

        return timeString;
    }

})();
