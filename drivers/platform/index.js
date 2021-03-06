/**
 * Ninja Blocks arduino controller
 */

var
	serialport = require('serialport')
	, stream = require('stream')
	, util = require('util')
	, path = require('path')
	, net = require('net')
	, fs = require('fs')
	, metaEvents = require('./lib/meta-events.js')
	, deviceStream = require('./lib/device-stream.js')
	, platformDevice = require('./lib/platform-device.js')
	, deviceHandlers = require('./lib/handlers.js')
	, configHandlers = require('./lib/config')
;

const kUtilBinPath = "/opt/utilities/bin/";
const kArduinoFlashScript = "ninja_upate_arduino";

const kArduinoParamsFile = "/etc/opt/ninja/.arduino_update_params";
const kArduinoUpdatedFile = "/etc/opt/ninja/.has_updated_arduino";

/**
 * platform.device = serial / net stream to device data (JSON stream)
 *
 */
function platform(opts, app, version) {

	var
		str = undefined
		, mod = this
	;

	//version to flash. Set by config.
	this.arduinoVersionToDownload = "V12"; //default to most common hardware

	this.retry = {

		delay : 3000
		, timer : null
		, count : 0
		, max : 3
	};

	stream.call(this);
	this.app = app;
	this.log = app.log;
	this.opts = opts || { };
	this.queue = [ ];
	this.device = undefined;
	this.channel = undefined;
	this.debounce = [ ];

	this.statusLights = [

		{
			state : "client::up"
			, color : "00FF00"
		}
		, {
			state : "client::down"
			, color : "FFFF00"
		}
		, {
			state : "client::authed"
			, color : "00FFFF"
		}
		, {
			state : "client::activation"
			, color : "FF00FF"
		}
		, {
			state : "client::invalidToken"
			, color : "0000FF"
		}
		, {
			state : "client::reconnecting"
			, color : "00FFFF"
		}
		, {
			state : "client::updating"
			, color : "FFFFFF"
		}
	];


	if((!opts.devicePath) && opts.env == "production") {

		this.opts.devicePath = "/dev/ttyO1";
	}
	// don't bother if neither are specified
	if(!opts.devicePath && !opts.deviceHost) {

		return this.log.info("platform: No device specified");
	}
	else {

		if(!this.createStream()) {

			this.log.error("platform: Error creating device stream");
		}
	}

	/**
	 * Bind listeners for app state
	 * make the status LED do its thing
	 */
	this.statusLights.forEach(function(state) {

		app.on(state.state, function() {

			if(!mod.device) { return; }
			mod.device.write(JSON.stringify({
				DEVICE : [
					{
						G : "0"
						, V : 0
						, D : 999
						, DA : state.color
					}
				]
			}));
		});
	});

	/**
	 * Get version from arduino
	 */
	function getVersion() { 

		if(!mod.device) { return; } 
		mod.device.write('{"DEVICE":[{"G":"0","V":0,"D":1003,"DA":"VNO"}]}'); 
	};

	this.once('open', function() {

		var versionSpam = setInterval(function() {

			getVersion();
		}, 500);

		mod.once('version', function(ver) {

			version(ver);
			clearTimeout(versionSpam);
		});
		
		setTimeout(function() {

			clearTimeout(versionSpam);
		}, 2000);
	});

	app.on('device::command', mod.onCommand.bind(mod));
};

util.inherits(platform, stream);

deviceHandlers(platform);
deviceStream(platform);
metaEvents(platform);

platform.prototype.config = function(rpc,cb) {

  var self = this;

  if (!rpc) {
    return configHandlers.probe.call(this,cb);
  }

  switch (rpc.method) {
    case 'manual_board_version':   return configHandlers.manual_board_version.call(this,rpc.params,cb); break;
    case 'confirm_flash_arduino':  return configHandlers.confirm_flash_arduino.call(this,rpc.params,cb); break;
    case 'flashduino_begin':  return configHandlers.flashduino_begin.call(this,rpc.params,cb); break;
    default:               return cb(true);                                              break;
  }
};

platform.prototype.setArduinoVersionToDownload = function(version) {
	this.arduinoVersionToDownload = version;
}

platform.prototype.flashArduino = function() {
	var params = '-f ' + this.arduinoVersionToDownload;
	this.log.info('platform: setting params, \'' + params + '\'');
	self = this;
    fs.writeFile(kArduinoParamsFile, params, function(err) { //write params to file
   		if(err) {
        	console.log(err);
    	} else {
			fs.unlink(kArduinoUpdatedFile, function (err) { //delete file to trigger update on next run
  			if (err) {
			} else {
				self.log.info('platform: flashing arduino...' + this.arduinoVersionToDownload);
				process.exit(); //restart so /etc/init/ninjablock.conf can run
			}
			});
		}
	});
}

platform.prototype.sendData = function(dat) {

	if(!dat) { return; }
	this.emit('data', dat);
};

platform.prototype.sendConfig = function(type, dat) {

	if(!dat) { return; }
	dat.type = type;
	this.emit('config', dat);
};

platform.prototype.getJSON = function getJSON(data) {

	try {

		return JSON.parse(data);
	}
	catch(e) { }
	return null;
};

module.exports = platform;
