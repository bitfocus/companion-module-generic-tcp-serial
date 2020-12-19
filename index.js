/**
 * Class tsp TCP Server for Companion
 * Copyright 2020 Information Systems Technology
 */

const net   		= require('net');
const SerialPort 	= require('serialport');
const instance_skel = require('../../instance_skel');

/**
 * Returns the passed string expanded to 2-digit hex for each character
 * @param {string} data: string to hexify
 * @param {string} delim: string to insert between characters
 * @since 1.0.0
 */
const toHex = (data, delim = '') => {
	return [...data].map( (hex) => {
		return (('0' + Number(hex.charCodeAt(0)).toString(16)).slice(-2));
	}).join(delim);
 };

/**
 * Companion instance class tsp
 * creates a small TCP server for a selected serial port
 *
 * @extends instance_skel
 * @version 1.0.0
 * @since 1.0.0
 * @author John A Knight, Jr <istnv@ayesti.com>
 */
class instance extends instance_skel {

	/**
	 * Create a new instance of class ip-serial
	 * @param {EventEmitter} system - event processor/scheduler
	 * @param {String} id - unique identifier of this instance
	 * @param {Object} config -	configuration items saved by Companion
	 * @since 1.0.0
	 */
	constructor(system, id, config) {

		super(system, id, config);

		// serial port configuration choices
		this.CHOICES_BAUD_RATES =
			[9600, 14400, 19200, 38400, 57600, 115200, 110, 300, 1200, 2400, 4800].map( (v) => {
				return { id: v, label: v + ' Baud'};
			});

		this.CHOICES_BITS =
			[8,7,6,5].map ( (v) => {
				return { id: v, label: v + ' Bits'};
			});

		this.CHOICES_PARITY =
			['None','Even','Odd','Mark','Space'].map( (v) => {
				return { id: v.toLowerCase(), label: v};
			});

		this.CHOICES_STOP =
			[1, 2].map ( (v) => {
				return { id: v, label: v + ' Bits'};
			});

		// Wait a few seconds so we don't spam log with 'no ports/unconfigured'
		// as those processes take a few moments to settle
		this.LOG_DELAY = 10000;

		// module defaults
		this.foundPorts = [];
		this.tSockets = [];
		this.sPortPath = 'none';
		this.isOpen = false;
		this.IPPort = 32100;
	}

	/**
	 * Clear all ports and timers
	 * @since 1.0.1
	 */
	clearAll() {
		if (this.portScan) {
			clearInterval(this.portScan);
			delete this.portScan;
		}
		if (this.tSockets) {
			this.tSockets.forEach(sock => {
				sock.end();
				sock.removeAllListeners();
			});
			delete this.tSockets;
		}
		if (this.tServer) {
			if (this.tServer.connections>0) {
				this.tServer.close();
			}
			this.tServer.removeAllListeners();
			delete this.tServer;
		}
		if (this.sPort) {
			this.sPort.removeAllListeners();
			if (this.sPort.isOpen) {
				this.sPort.close();
			}
			delete this.sPort;
		}
	}

	/**
	 * Cleanup module before being disabled or closed
	 * @since 1.0.0
	 */
	destroy() {
		this.clearAll();
		this.status(this.STATUS_UNKNOWN,'Disabled');
		this.debug("destroyed");
	}

	/**
	 * Initialize the module.
	 * Called once when the system is ready for the module to start.
	 * @since 1.0.0
	 */
	init() {
		this.applyConfig(this.config);
	}

	/**
	 * Apply user configuration parameters and start the server.
	 *
	 * @param {Object} config - saved user configuration items
	 * @since 1.0.0
	 */
	applyConfig(config) {

		this.clearAll();
		this.isListening = false;
		this.IPPort = config.iport || 32100;
		this.sPortPath = config.sport || 'none';
		this.tSockets = [];
		this.isOpen = false;
		this.startedAt = Date.now();
		this.portScan = setInterval(() => this.scanForPorts(), 5000);
		this.scanForPorts();
		this.init_variables();
		this.updateVariables();
	}

	/**
	 * Called when 'Apply changes' is pressed on the module 'config' tab
	 * @param {Object} config - updated user configuration items
	 * @since 1.0.0
	 */
	updateConfig(config) {
		this.config = config;
		this.applyConfig(config);
	}

	/**
	 * Initialize the serial port and attach for read/write
	 * @since 1.0.0
	 */
	init_serial() {
		if (this.sPortPath == '' || this.sPortPath === 'none') {
			// not configured yet
			return;
		}

		let portOptions = {
			autoOpen: false,
			baudRate: parseInt(this.config.baud),
			dataBits: parseInt(this.config.bits),
			stopBits: parseInt(this.config.stop),
			parity: this.config.parity
		};

		this.sPort = new SerialPort(this.sPortPath,	portOptions);

		this.sPort.on('error', this.updateStatus.bind(this));

		this.sPort.on('open', this.init_tcp.bind(this));

		this.sPort.on('close', (err) => {
			this.updateStatus(err);
			if (err.disconnected) {
				// close all connections
				this.tSockets.forEach(sock => sock.end());
				this.tServer.close();
				this.isListening = false;
			}
		});

		this.sPort.on('data', (data) => {
			// make sure client is connected
			if (this.tSockets.length>0) {
				// forward data to the TCP connection (data is a buffer)
				this.debug("COM> " + toHex(data.toString('latin1'),' '));
				this.tSockets.forEach(sock => sock.write(data));
			}
		});

		this.sPort.open();

		this.updateStatus();
	}


	/**
	 * Update the dynamic variable(s)
	 * since 1.0.0
	 */
	updateVariables() {
		let addr = 'Not connected';

		if (this.tSockets.length > 0) {
			addr = this.tSockets.map( (s) => s.remoteAddress+':'+s.remotePort).join('\n');
		}
		this.setVariable('ip_addr',addr);
	}


	/**
	 * Initialize the TCP server (after the serial port is ready)
	 * @since 1.0.0
	 */
	init_tcp() {
		let tServer = this.tServer = new net.Server();

		tServer.maxConnections = 4;

		tServer.on('error', (err) => {
			this.updateStatus(err);
		});

		tServer.on('connection', (socket) => {
			let cid = socket.remoteAddress + ":" + socket.remotePort;
			socket.setEncoding('latin1');
			this.tSockets.push(socket);
			this.updateVariables();

			socket.on('err', this.updateStatus.bind(this));

			socket.on('close',() => {
				this.tSockets.splice(this.tSockets.indexOf(socket), 1);
				this.isListening = this.tSockets.length > 0;
				this.updateVariables();
			});

			socket.on('data', (data) => {
				// forward data to the serial port
				this.debug("TCP: " + toHex(data.toString('latin1'),' '));
				this.sPort.write(data);
			});

		});

		tServer.listen(this.IPPort);

		this.isListening = true;
		this.updateStatus();
	}


	/**
	 * Update companion status and log
	 * @param {Object} err - optional error message from sPort or tPort
	 */
	updateStatus(err) {
		let s;
		let l;
		let m;

		if (this.isListening) {
			l = 'info';
			s = this.STATUS_OK;
			m = `Listening on port ${this.IPPort}`;
		} else if (err) {
			l = 'error';
			s = this.STATUS_ERROR;
			m = `Error: ${err.message}`;
		} else if (!this.foundPorts || this.startedAt + this.LOG_DELAY > Date.now()) {
			// haven't scanned yet so the rest of the statuses don't apply
			s = null;
		} else if (this.foundPorts.length==0) {
			l = 'error';
			s = this.STATUS_WARNING;
			m = "No serial ports detected";
		} else if (this.sPort && this.sPortPath !== 'none') {
			l = 'info';
			s = this.STATUS_UNKNOWN;
			m = `Connecting to ${this.sPortPath}`;
		} else {
			l = 'error';
			s = this.STATUS_WARNING;
			m = "No serial port configured";
		}

		if (s!=null && l + m + s != this.lastStatus) {
			this.status(s, m);
			this.log(l,m);
			this.lastStatus = l + m + s;
		}

	}

	/**
	 * Periodically scan the system for attached serial ports
	 * This is the callback attached to portScan interval timer
	 * @since 1.0.0
	 */
	scanForPorts() {
		let setSerial = false;

		setSerial = this.foundPorts.length > 0 && !this.sPort;
		setSerial = setSerial || (this.sPort && !this.sPort.isOpen);
		if (!this.sPort || !this.sPort.isOpen) {
			this.updateStatus();
			this.findPorts();
		}
		if (setSerial) {
			this.init_serial();
		}
	}

	/**
	 * The actual port scanner function
	 * @since 1.0.0
	 */
	findPorts() {
		if (this.scanning) {
			return;
		}

		this.scanning = true;
		this.foundPorts = [];

		SerialPort.list()
			.then(ports => {
				ports.forEach((p) => {
					if (p.locationId || p.pnpId ) {
						this.foundPorts.push({path: (p.path? p.path : p.comName), manufacturer: (p.manufacturer ? p.manufacturer : "Internal")});
					}
				});
				if (this.foundPorts.length>0) {
					this.foundPorts.unshift({path: 'none',manufacturer: "Not configured"});
				}
				this.updateStatus();
				this.scanning = false;
			}, err => {
				this.debug("SerialPort.list: " + err);
				this.scanning = false;
			}
		);
	}

	/**
	 * Define the dynamic variables for Companion
	 * @since 1.0.0
	 */
	 init_variables() {
		 this.setVariableDefinitions ([
			 {
				label: 'Remote IP address',
				name: 'ip_addr'
			 }
		 ]);
	 }


	/**
	 * Define the items that are user configurable.
	 * Return them to companion.
	 * @since 1.0.0
	 */
	config_fields() {
		let ports = [];

		let fields =  [
			{
				type: 'text',
				id: 'info',
				width: 12,
				label: 'Information',
				value: "This is a helper module to provide TCP access to a serial port",
			},
			{
				type: 'textinput',
				id: 'iport',
				label: 'Listen Port',
				tooltip: 'Enter the IP Port to listen for TCP connections on this computer',
				width: 8,
				default: this.IPPort,
				regex: this.REGEX_PORT
			}
		];

		if (this.foundPorts.length==0) {
			fields.push({
				type: 'text',
				id: 'info1',
				width: 12,
				label: 'Try again',
				value: "No ports detected yet, which may take a few seconds.<br>Select the 'Instances' tab and wait for log entry 'No serial port configured' Then choose 'Edit' to return here. "
			});
		} else {

			if (this.foundPorts && this.foundPorts.length) {
				this.foundPorts.forEach( (port) => {
					ports.push( { id: port.path, label: `${port.manufacturer} (${port.path})` });
				});
			} else {
				ports = [ { id: 'none', label: "No serial ports detected"}];
			}

			fields.push(
				{
					type: 'dropdown',
					id: 'sport',
					label: 'Serial port',
					width: 12,
					default: ports[0].id,
					choices: ports
				},
				{
					type: 'dropdown',
					id: 'baud',
					label: 'Baud Rate',
					width: 6,
					default: this.CHOICES_BAUD_RATES[0].id,
					choices: this.CHOICES_BAUD_RATES
				},
				{
					type: 'dropdown',
					id: 'bits',
					label: 'Data Bits',
					width: 6,
					default: this.CHOICES_BITS[0].id,
					choices: this.CHOICES_BITS
				},		{
					type: 'dropdown',
					id: 'parity',
					label: 'Parity',
					width: 6,
					default: this.CHOICES_PARITY[0].id,
					choices: this.CHOICES_PARITY
				},
				{
					type: 'dropdown',
					id: 'stop',
					label: 'Stop Bits',
					width: 6,
					default: this.CHOICES_STOP[0].id,
					choices: this.CHOICES_STOP
				}
			);
		}

		return fields;

	}

}

exports = module.exports = instance;
