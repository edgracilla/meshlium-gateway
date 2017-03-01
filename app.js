'use strict'

const reekoh = require('reekoh')
const plugin = new reekoh.plugins.Gateway()

const async = require('async')
const isEmpty = require('lodash.isempty')

let server = null

plugin.once('ready', () => {
  let get = require('lodash.get')
  let mosca = require('mosca')

  let options = plugin.config
  let topic = options.topic

  server = new mosca.Server({
    port: options.port
  })

  server.once('error', (error) => {
    console.error('Meshlium Gateway - Server Error', error)
    plugin.logException(error)

    setTimeout(() => {
      server.close(() => {
        server.removeAllListeners()
        process.exit()
      })
    }, 5000)
  })

  server.once('ready', () => {
    if (!isEmpty(options.user) && !isEmpty(options.password)) {
      server.authenticate = (client, username, password, callback) => {
        username = (!isEmpty(username)) ? username.toString() : ''
        password = (!isEmpty(password)) ? password.toString() : ''

        if (options.user === username && options.password === password) {
          return callback(null, true)
        } else {
          plugin.log(`Meshlium Gateway - Authentication Failed on Client: ${(!isEmpty(client)) ? client.id : 'No Client ID'}.`)
          callback(null, false)
        }
      }
    }

    plugin.log(`Meshlium Gateway initialized on port ${options.port}`)
    plugin.emit('init')
  })

  server.once('closed', () => {
    plugin.log(`Meshlium Gateway closed on port ${options.port}`)
  })

  server.on('clientConnected', (client) => {
    plugin.log(`Meshlium Gateway Device Connection received. Device ID: ${client.id}`)
    plugin.notifyConnection(client.id)
  })

  server.on('clientDisconnected', (client) => {
    plugin.log(`Meshlium Gateway Device Disconnection received. Device ID: ${client.id}`)
    plugin.notifyDisconnection(client.id)
  })

  server.on('published', (message, client) => {
    if (message.topic === topic) {
      let msg = message.payload.toString()

      async.waterfall([
        async.constant(msg || '{}'),
        async.asyncify(JSON.parse)
      ], (error, obj) => {
        if (error || isEmpty(obj.id_wasp)) {
          return plugin.logException(new Error(`Invalid data sent. Data must be a valid JSON String with at least an "id_wasp" field which corresponds to a registered Device ID. Raw Data: ${msg}`))
        }

        plugin.requestDeviceInfo(obj.id_wasp).then((deviceInfo) => {
          if (isEmpty(deviceInfo)) {
            return plugin.log(JSON.stringify({
              title: 'Meshlium Gateway - Unauthorized Device',
              device: obj.id_wasp
            }))
          }

          async.waterfall([
            async.constant(deviceInfo),
            async.asyncify(JSON.parse)
          ], (err, info) => {
            if (err) console.log('returned deviceInfo is not a valid JSON')

            return plugin.setDeviceState(info.device._id, {
              current_reading: obj,
              previous_reading: get(info, 'state.current_reading') || {}
            }).then(() => {
              return plugin.pipe(info).then(() => {
                plugin.emit('piped')
                return plugin.log(JSON.stringify({
                  title: 'Meshlium Gateway - Data Received.',
                  device: client.id,
                  data: obj
                }))
              })
            })
          })
        }).catch((err) => {
          console.error(err)
          plugin.logException(err)
        })
      })
    }
  })
})

module.exports = plugin
