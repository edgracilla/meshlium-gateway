'use strict';

var async    = require('async'),
	isEmpty  = require('lodash.isempty'),
	platform = require('./platform'),
	server, port;

platform.on('close', function () {
	let d = require('domain').create();

	d.once('error', function (error) {
		console.error(`Error closing Meshlium Gateway on port ${port}`, error);
		platform.handleException(error);
		platform.notifyClose();
		d.exit();
	});

	d.run(function () {
		server.close(() => {
			d.exit();
		});
	});
});

platform.once('ready', function (options) {
	let get    = require('lodash.get'),
		mosca  = require('mosca'),
		config = require('./config.json');

	let topic = options.topic || config.topic.default;

	port = options.port;
	server = new mosca.Server({
		port: port
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
					let t = setTimeout(() => {
						platform.removeAllListeners(requestId);
					}, 5000);

					platform.once(requestId, (deviceInfo) => {
						clearTimeout(t);

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

		platform.log(`Meshlium Gateway initialized on port ${port}`);
		platform.notifyReady();
	});
});
