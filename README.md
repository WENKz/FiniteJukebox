# Finite Jukebox

Finite Jukebox is a userscript allowing the recording of audio from [Infinite Jukebox]. Rather than making use of a system-wide recording application, Finite Jukebox leverages the Web Audio API that powers [Infinite Jukebox]. Once recording is complete, the audio can be exported to as a wav file. Additionally, a timed record feature allows you to set a minimum length of recording after which recording will automatically stop.

## Compatibility

Unknown. Only tested on the latest version of Chrome. However, the project makes use of Blobs and Web Workers.

## Installation

### [Tampermonkey]
Navigate to the raw version of [finiteJukebox.user.js](https://raw.githubusercontent.com/kwongius/FiniteJukebox/master/finiteJukebox.user.js) and select *Install*.

## Credits

This project makes use of [FileSaver.js] by Eli Grey. Additionally, portions were modified from Matt Diamond's [Recorder.js].

[Infinite Jukebox]: http://infinitejuke.com/
[FileSaver.js]: https://github.com/eligrey/FileSaver.js
[Recorder.js]: https://github.com/mattdiamond/Recorderjs
[Tampermonkey]: http://tampermonkey.net/
