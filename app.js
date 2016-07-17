'use strict';

var async    = require('async'),
	isEmpty  = require('lodash.isempty'),
	platform = require('./platform'),
	server;

platform.on('close', function () {
	let d = require('domain').create();

	d.once('error', function (error) {
		platform.handleException(error);
		platform.notifyClose();
		d.exit();
	});

	d.run(function () {
		server.close(() => {
			server.removeAllListeners();
			platform.notifyClose();
			d.exit();
		});
	});
});

platform.once('ready', function (options) {
	let get    = require('lodash.get'),
		mosca  = require('mosca'),
		config = require('./config.json');

	let topic = options.topic || config.topic.default;

	server = new mosca.Server({
		port: options.port
	});

	server.once('error', (error) => {
		console.error('Meshlium Gateway - Server Error', error);
		platform.handleException(error);

		setTimeout(() => {
			server.close(() => {
				server.removeAllListeners();
				process.exit();
			});
		}, 5000);
	});

	server.once('ready', () => {
		if (!isEmpty(options.user) && !isEmpty(options.password)) {
			server.authenticate = (client, username, password, callback) => {
				username = (!isEmpty(username)) ? username.toString() : '';
				password = (!isEmpty(password)) ? password.toString() : '';

				if (options.user === username && options.password === password)
					return callback(null, true);
				else {
					platform.log(`Meshlium Gateway - Authentication Failed on Client: ${(!isEmpty(client)) ? client.id : 'No Client ID'}.`);
					callback(null, false);
				}
			};
		}

		platform.log(`Meshlium Gateway initialized on port ${options.port}`);
		platform.notifyReady();
	});

	server.once('closed', () => {
		platform.log(`Meshlium Gateway closed on port ${options.port}`);
	});

	server.on('clientConnected', (client) => {
		platform.log(`Meshlium Gateway Device Connection received. Device ID: ${client.id}`);
		platform.notifyConnection(client.id);
	});

	server.on('clientDisconnected', (client) => {
		platform.log(`Meshlium Gateway Device Disconnection received. Device ID: ${client.id}`);
		platform.notifyDisconnection(client.id);
	});

	server.on('published', (message, client) => {
		if (message.topic === topic) {
			let msg = message.payload.toString();

			async.waterfall([
				async.constant(msg || '{}'),
				async.asyncify(JSON.parse)
			], (error, obj) => {
				if (error || isEmpty(obj.id_wasp)) return platform.handleException(new Error(`Invalid data sent. Data must be a valid JSON String with at least an "id_wasp" field which corresponds to a registered Device ID. Raw Data: ${msg}`));

				platform.requestDeviceInfo(obj.id_wasp, (error, requestId) => {
					platform.once(requestId, (deviceInfo) => {
						if (isEmpty(deviceInfo)) {
							return platform.log(JSON.stringify({
								title: 'Meshlium Gateway - Unauthorized Device',
								device: obj.id_wasp
							}));
						}

						platform.setDeviceState(deviceInfo._id, {
							current_reading: obj,
							previous_reading: get(deviceInfo, 'state.current_reading') || {}
						}, function () {
							platform.processData(obj.id_wasp, msg);

							platform.log(JSON.stringify({
								title: 'Meshlium Gateway - Data Received.',
								device: client.id,
								data: obj
							}));
						});
					});
				});
			});
		}
	});
});
