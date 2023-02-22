/**
 * Class tsp TCP Server for Companion
 * Copyright 2020 Information Systems Technology
 */

/* eslint-disable no-useless-escape */
import { combineRgb, Regex, TCPHelper } from '@companion-module/base'
import * as net from 'net'
import { runEntrypoint, InstanceBase, InstanceStatus } from '@companion-module/base'
import { SerialPort } from 'serialport'

import * as CHOICES from './choices.js'

const UpgradeScripts = []

/**
 * Returns the passed string expanded to 2-digit hex for each character
 * @param {string} data: string to hexify
 * @param {string} delim: string to insert between characters
 * @since 1.0.0
 */
const toHex = (data, delim = '') => {
	return [...data]
		.map((hex) => {
			return ('0' + Number(hex.charCodeAt(0)).toString(16)).slice(-2)
		})
		.join(delim)
}

/**
 * Companion instance class tsp
 * creates a small TCP server for a selected serial port
 *
 * @extends InstanceBase
 * @version 2.0.0
 * @since 1.0.0
 * @author John A Knight, Jr <istnv@istnv.com>
 */
class TSPInstance extends InstanceBase {
	/**
	 * Create a new instance of class ip-serial
	 * @param {Object} internal -	Internal Companion reference
	 * @version 2.0.0
	 * @since 1.0.0
	 */
	constructor(internal) {
		super(internal)

		// Wait a few seconds so we don't spam log with 'no ports/unconfigured'
		// as those processes take a few moments to settle
		this.LOG_DELAY = 10000

		// module defaults
		this.foundPorts = []
		this.tSockets = []
		this.sPortPath = 'none'
		this.isOpen = false
		this.IPPort = 32100
	}

	/**
	 * Clear all ports and timers
	 * @since 1.0.1
	 */
	clearAll() {
		if (this.portScan) {
			clearInterval(this.portScan)
			delete this.portScan
		}
		if (this.tSockets) {
			this.tSockets.forEach((sock) => {
				sock.end()
				sock.removeAllListeners()
			})
			delete this.tSockets
		}
		if (this.tServer) {
			if (this.tServer.connections > 0) {
				this.tServer.close()
			}
			this.tServer.removeAllListeners()
			delete this.tServer
		}
		if (this.sPort) {
			this.sPort.removeAllListeners()
			if (this.sPort.isOpen) {
				this.sPort.close()
			}
			delete this.sPort
		}
	}

	/**
	 * Cleanup module before being disabled or closed
	 * @since 1.0.0
	 */
	async destroy() {
		this.clearAll()
		clearInterval(this.SERIAL_INTERVAL)
		this.updateStatus(InstanceStatus.Disconnected, 'Disabled')
		this.log('debug','Destroyed')
	}

	/**
	 * Initialize the module.
	 * Called once when the system is ready for the module to start.
	 *
	 * @param {Object} config - module configuration details
	 * @version
	 * @since 1.0.0
	 */
	async init(config) {
		this.applyConfig(config)
	}

	/**
	 * Apply user configuration parameters and start the server.
	 *
	 * @param {Object} config - saved user configuration items
	 * @since 1.0.0
	 */
	applyConfig(config) {
		this.config = config
		this.clearAll()
		this.isListening = false
		this.IPPort = config.iport || 32100
		this.sPortPath = config.sport || 'none'
		this.tSockets = []
		this.isOpen = false
		this.startedAt = Date.now()
		this.portScan = setInterval(() => this.scanForPorts(), 5000)
		this.scanForPorts()
		this.init_actions()
		this.init_variables()
		this.updateVariables()
	}

	/**
	 * Called when 'Apply changes' is pressed on the module 'config' tab
	 * @param {Object} config - updated user configuration items
	 * @since 2.0.0
	 */
	async configUpdated(config) {
		this.config = config
		this.applyConfig(config)
	}

	/**
	 * Initialize the serial port and attach for read/write
	 * @since 1.0.0
	 */
	init_serial() {
		if (this.sPortPath == '' || this.sPortPath === 'none') {
			// not configured yet
			return
		}

		let portOptions = {
			path: this.sPortPath,
			autoOpen: false,
			baudRate: parseInt(this.config.baud),
			dataBits: parseInt(this.config.bits),
			stopBits: parseInt(this.config.stop),
			parity: this.config.parity,
		}

		this.sPort = new SerialPort(portOptions)

		this.sPort.on('error', this.doUpdateStatus.bind(this))

		this.sPort.on('open', this.init_tcp.bind(this))

		this.sPort.on('close', (err) => {
			this.doUpdateStatus(err)
			if (err.disconnected) {
				// close all connections
				this.tSockets.forEach((sock) => sock.end())
				this.tServer.close()
				this.isListening = false
			}
		})

		this.sPort.on('data', (data) => {
			// make sure client is connected
			if (this.tSockets.length > 0) {
				// forward data to the TCP connection (data is a buffer)
				this.log('debug','COM> ' + toHex(data.toString('latin1') + ' '))
				this.tSockets.forEach((sock) => sock.write(data))
			}
			clearInterval(this.SERIAL_INTERVAL)
		})

		this.sPort.open()

		this.doUpdateStatus()
	}

	/**
	 * Update the dynamic variable(s)
	 * since 1.0.0
	 */
	updateVariables() {
		let addr = 'Not connected'

		if (this.tSockets.length > 0) {
			addr = this.tSockets.map((s) => s.remoteAddress + ':' + s.remotePort).join('\n')
		}
		this.setVariableValues({ ip_addr: addr })
	}

	/**
	 * Initialize the TCP server (after the serial port is ready)
	 * @since 1.0.0
	 */
	init_tcp() {
		let tServer = (this.tServer = new net.Server())

		tServer.maxConnections = 4

		tServer.on('error', (err) => {
			this.doUpdateStatus(err)
		})

		tServer.on('connection', (socket) => {
			let cid = socket.remoteAddress + ':' + socket.remotePort
			this.tSockets.push(socket)
			this.updateVariables()

			socket.on('err', this.doUpdateStatus.bind(this))

			socket.on('close', () => {
				this.tSockets.splice(this.tSockets.indexOf(socket), 1)
				this.isListening = this.tSockets.length > 0
				this.updateVariables()
			})

			socket.on('data', (data) => {
				// forward data to the serial port
				this.log('debug','TCP: ' + toHex(data.toString('latin1') + ' '))
				this.sPort.write(data)
				if (this.config.response == true) {
					this.SERIAL_INTERVAL = setTimeout(this.sendError.bind(this), this.config.maxresponse)
				}
			})
		})

		tServer.listen(this.IPPort)

		this.isListening = true
		this.doUpdateStatus()
	}

	/**
	 * Send an error to all TCP sockets if no response was receieved on the Serial Port
	 * @since 1.0.7
	 */

	sendError() {
		this.updateStatus(InstanceStatus.Error)
		this.log(
			'error',
			'Error: No response received via Serial connection in the max allotted time of ' + this.config.maxresponse + 'ms'
		)
		let msg = this.config.errormessage
		try {
			this.tSockets.forEach((sock) => sock.write(msg))
		} catch (error) {
			this.log('debug', 'Unable to send error message to sockets: ' + error.toString())
		}

		clearInterval(this.SERIAL_INTERVAL)
	}

	/**
	 * Update companion status and log
	 * @param {Object} err - optional error message from sPort or tPort
	 */
	doUpdateStatus(err) {
		let s
		let l
		let m

		if (this.isListening) {
			l = 'info'
			s = InstanceStatus.Ok
			m = `Listening on TCP port ${this.IPPort}`
		} else if (err) {
			l = 'error'
			s = InstanceStatus.Error
			m = `Error: ${err.message}`
		} else if (!this.foundPorts || this.startedAt + this.LOG_DELAY > Date.now()) {
			// haven't scanned yet so the rest of the statuses don't apply
			s = null
		} else if (this.foundPorts.length == 0) {
			l = 'error'
			s = InstanceStatus.ConnectionFailure
			m = 'No serial ports detected'
		} else if (this.sPort && this.sPortPath !== 'none') {
			l = 'info'
			s = InstanceStatus.Connecting
			m = `Connecting to ${this.sPortPath}`
		} else {
			l = 'error'
			s = InstanceStatus.BadConfig
			m = 'No serial port configured'
		}

		if (s != null && l + m + s != this.lastStatus) {
			this.updateStatus(s, m)
			this.log(l, m)
			this.lastStatus = l + m + s
		}
	}

	/**
	 * Periodically scan the system for attached serial ports
	 * This is the callback attached to portScan interval timer
	 * @since 1.0.0
	 */
	scanForPorts() {
		let setSerial = false

		setSerial = this.foundPorts.length > 0 && !this.sPort
		setSerial = setSerial || (this.sPort && !this.sPort.isOpen)
		if (!this.sPort || !this.sPort.isOpen) {
			this.doUpdateStatus()
			this.findPorts()
		}
		if (setSerial) {
			this.init_serial()
		}
	}

	/**
	 * The actual port scanner function
	 * @since 1.0.0
	 */
	findPorts() {
		if (this.scanning) {
			return
		}

		this.scanning = true
		this.foundPorts = []

		SerialPort.list().then(
			(ports) => {
				ports.forEach((p) => {
					if (p.locationId || p.pnpId) {
						this.foundPorts.push({
							path: p.path ? p.path : p.comName,
							manufacturer: p.manufacturer ? p.manufacturer : 'Internal',
						})
					}
				})
				if (this.foundPorts.length > 0) {
					this.foundPorts.unshift({ path: 'none', manufacturer: 'Not configured' })
				}
				this.doUpdateStatus()
				this.scanning = false
			},
			(err) => {
				this.log('debug','SerialPort.list: ' + err)
				this.scanning = false
			}
		)
	}

	/**
	 * Initialize Actions
	 * @since 1.0.7
	 */

	init_actions() {
		let self = this

		let actionsArr = {
			previousSPort: {
				name: 'Select Previous Serial Port in List',
				options: [],
				callback: async (action, context)  => {
					try {
						let index = self.foundPorts.findIndex((port) => port.path == self.config.sport)
						index--

						if (index > 0) {
							self.log('info', 'Selecting previous Serial port in list: ' + self.foundPorts[index].path)
							if (self.sPort) {
								//close the serial port if it is already opened
								self.log('info', 'First closing already open port: ' + self.config.sport)
								self.sPort.removeAllListeners()
								if (self.sPort.isOpen) {
									self.sPort.close()
								}
								delete self.sPort
							}

							self.config.sport = self.foundPorts[index].path

							self.applyConfig(self.config)
						} else {
							self.log('info', 'Cannot select previous Serial port in list: Already on the first port in the list.')
						}
					} catch (error) {
						self.log('debug', 'Error Selecting previous Serial Port in List: ' + error.toString())
					}
				},
			},

			nextSPort: {
				name: 'Select Next Serial Port in List',
				options: [],
				callback: async (action, context) => {
					try {
						let index = self.foundPorts.findIndex((port) => port.path == self.config.sport)
						index++

						if (index < self.foundPorts.length) {
							self.log('info', 'Selecting next Serial port in list: ' + self.foundPorts[index].path)
							if (self.sPort) {
								//close the serial port if it is already opened
								self.log('info', 'First closing already open port: ' + self.config.sport)
								self.sPort.removeAllListeners()
								if (self.sPort.isOpen) {
									self.sPort.close()
								}
								delete self.sPort
							}

							self.config.sport = self.foundPorts[index].path

							self.applyConfig(self.config)
						} else {
							self.log('info', 'Cannot select next Serial port in list: Already on the last port in the list.')
						}
					} catch (error) {
						self.log('debug', 'Error Selecting next Serial Port in List: ' + error.toString())
					}
				},
			},
		}

		this.setActionDefinitions(actionsArr)
	}

	/**
	 * Define the dynamic variables for Companion
	 * @since 1.0.0
	 */
	init_variables() {
		this.setVariableDefinitions([
			{
				name: 'Remote IP address',
				variableId: 'ip_addr',
			},
		])
	}

	/**
	 * Define the items that are user configurable.
	 * Return them to companion.
	 * @since 2.0.0
	 */
	getConfigFields() {
		let ports = []

		const fields = [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'Information',
				value: 'This is a helper module to provide TCP access to a serial port',
			},
			{
				type: 'textinput',
				id: 'iport',
				label: 'Listen Port',
				tooltip: 'Enter the IP Port to listen for TCP connections on this computer',
				width: 8,
				default: this.IPPort,
				regex: Regex.PORT,
			},
		]

		if (this.foundPorts.length == 0) {
			fields.push({
				type: 'static-text',
				id: 'info1',
				width: 12,
				label: 'Try again',
				value:
					"No ports detected yet, which may take a few seconds.<br>Select the 'Connections' tab and wait for log entry 'No serial port configured' Then choose 'Edit' to return here. ",
			})
		} else {
			if (this.foundPorts && this.foundPorts.length) {
				this.foundPorts.forEach((port) => {
					ports.push({ id: port.path, label: `${port.manufacturer} (${port.path})` })
				})

				let portObj = ports.find((port) => port.id === this.config.sport)

				if (!portObj) {
					if (this.config.selectfirstfound) {
						this.log('info', 'Previously selected port (' + this.config.sport + ') not found.')
						if (this.ports.length > 1) {
							this.log('info', 'Selecting first found port: ' + ports[1].id)
							this.config.sport = ports[1].id
						}
					}
				}
			} else {
				ports = [{ id: 'none', label: 'No serial ports detected' }]
			}

			fields.push(
				{
					type: 'dropdown',
					id: 'sport',
					label: 'Serial port',
					width: 12,
					default: ports[0].id,
					choices: ports,
				},
				{
					type: 'dropdown',
					id: 'baud',
					label: 'Baud Rate',
					width: 6,
					default: CHOICES.BAUD_RATES[0].id,
					choices: CHOICES.BAUD_RATES,
				},
				{
					type: 'dropdown',
					id: 'bits',
					label: 'Data Bits',
					width: 6,
					default: CHOICES.BITS[0].id,
					choices: CHOICES.BITS,
				},
				{
					type: 'dropdown',
					id: 'parity',
					label: 'Parity',
					width: 6,
					default: CHOICES.PARITY[0].id,
					choices: CHOICES.PARITY,
				},
				{
					type: 'dropdown',
					id: 'stop',
					label: 'Stop Bits',
					width: 6,
					default: CHOICES.STOP[0].id,
					choices: CHOICES.STOP,
				}
			)

			//Select First Port if Previous Port is Not Found
			fields.push({
				type: 'checkbox',
				id: 'selectfirstfound',
				label: 'Select First Found Port if Previously Configured Port is Not Found',
				default: false,
				width: 12,
			})

			//Response Expected fields
			fields.push(
				{
					type: 'checkbox',
					id: 'response',
					label: 'Response Expected',
					default: false,
					width: 3,
				},
				{
					type: 'textinput',
					id: 'maxresponse',
					label: 'Max Response Time Allowed (in ms)',
					default: 1000,
					width: 3,
					isVisible: (configValues) => configValues.response === true,
				},
				{
					type: 'textinput',
					id: 'errormessage',
					label: 'Message to emit to TCP Clients if no response received',
					default: 'ERR:NORESPONSE',
					width: 3,
					isVisible: (configValues) => configValues.response === true,
				}
			)
		}

		return fields
	}
}

runEntrypoint(TSPInstance, UpgradeScripts)
