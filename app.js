'use strict';

var isEmpty           = require('lodash.isempty'),
	platform          = require('./platform'),
	authorizedDevices = {},
	server, port;

platform.on('adddevice', function (device) {
	if (!isEmpty(device) && !isEmpty(device._id)) {
		authorizedDevices[device._id] = device;
		platform.log(`Successfully added ${device._id} to the pool of authorized devices.`);
	}
	else
		platform.handleException(new Error(`Device data invalid. Device not added. ${device}`));
});

platform.on('removedevice', function (device) {
	if (!isEmpty(device) && !isEmpty(device._id)) {
		delete authorizedDevices[device._id];
		platform.log(`Successfully removed ${device._id}from the pool of authorized devices.`);
	}
	else
		platform.handleException(new Error(`Device data invalid. Device not removed. ${device}`));
});

platform.on('close', function () {
	let d = require('domain').create();

	d.once('error', (error) => {
		console.error(`Error closing Meshlium Gateway on port ${port}`, error);
		platform.handleException(error);
		platform.notifyClose();
		d.exit();
	});

	d.run(() => {
		server.close(() => {
			d.exit();
		});
	});
});

platform.once('ready', function (options, registeredDevices) {
	var keyBy  = require('lodash.keyby'),
		mosca  = require('mosca'),
		domain = require('domain'),
		config = require('./config.json');

	if (!isEmpty(registeredDevices))
		authorizedDevices = keyBy(registeredDevices, '_id');

	var topic = options.topic || config.topic.default;

	port = options.port;
	server = new mosca.Server({
		port: port
	});

	server.on('published', (message, client) => {
		if (message.topic === topic) {
			let d = domain.create();


			d.once('error', () => {
				platform.handleException(new Error(`Invalid data sent. Data must be a valid JSON String. Please upgrade your Meshlium Firmware. Raw Data: ${message.payload.toString()}`));

				d.exit();
			});

			d.run(() => {
				let msg = message.payload.toString(),
					obj = JSON.parse(msg);

				if (isEmpty(obj.id_wasp)) {
					platform.handleException(new Error(`Invalid data sent. Data must be a valid JSON String with at least an "id_wasp" field which corresponds to a registered Device ID. Raw Data: ${msg}`));

					return d.exit();
				}

				if (isEmpty(authorizedDevices[obj.id_wasp])) {
					platform.log(JSON.stringify({
						title: 'Meshlium Gateway - Unauthorized Device',
						device: obj.id_wasp
					}));

					return d.exit();
				}

				platform.processData(obj.id_wasp, msg);

				platform.log(JSON.stringify({
					title: 'Meshlium Gateway - Data Received.',
					device: client.id,
					data: obj
				}));

				d.exit();
			});
		}
	});

	server.on('closed', () => {
		console.log(`Meshlium Gateway closed on port ${port}`);
		platform.notifyClose();
	});

	server.on('error', (error) => {
		console.error('Meshlium Gateway - Server Error', error);
		platform.handleException(error);

		if (error.code === 'EADDRINUSE')
			process.exit(1);
	});

	server.on('ready', () => {
		server.authenticate = (client, username, password, callback) => {
			username = (!isEmpty(username)) ? username.toString() : '';
			password = (!isEmpty(password)) ? password.toString() : '';

			if (options.user !== username || options.password !== password) {
				platform.log(`Meshlium Gateway - Authentication Failed on Client: ${(!isEmpty(client)) ? client.id : 'No Client ID'}.`);
				callback(null, false);
			}
			else
				return callback(null, true);
		};

		platform.log(`Meshlium Gateway initialized on port ${port}`);
		platform.notifyReady();
	});
});
