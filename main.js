/**
 *
 * surepetcareio adapter
 *
 *
 *  file io-package.json comments:
 *
 *  {
 *      "common": {
 *          "name":         "surepetcareio",                  // name has to be set and has to be equal to adapters folder name and main file name excluding extension
 *          "version":      "0.0.0",                    // use "Semantic Versioning"! see http://semver.org/
 *          "title":        "Node.js surepetcareio Adapter",  // Adapter title shown in User Interfaces
 *          "authors":  [                               // Array of authord
 *              "name <mail@surepetcareio.com>"
 *          ]
 *          "desc":         "surepetcareio adapter",          // Adapter description shown in User Interfaces. Can be a language object {de:"...",ru:"..."} or a string
 *          "platform":     "Javascript/Node.js",       // possible values "javascript", "javascript/Node.js" - more coming
 *          "mode":         "daemon",                   // possible values "daemon", "schedule", "subscribe"
 *          "materialize":  true,                       // support of admin3
 *          "schedule":     "0 0 * * *"                 // cron-style schedule. Only needed if mode=schedule
 *          "loglevel":     "info"                      // Adapters Log Level
 *      },
 *      "native": {                                     // the native object is available via adapter.config in your adapters code - use it for configuration
 *          "test1": true,
 *          "test2": 42,
 *          "mySelect": "auto"
 *      }
 *  }
 *
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
'use strict';

// you have to require the utils module and call adapter function
const utils =    require(__dirname + '/lib/utils'); // Get common adapter utils

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.surepetcareio.0
const adapter = new utils.Adapter('surepetcareio');

const https = require('https');
const util = require('util')
const prettyMs = require('pretty-ms');

var numberOfLogins = 0;

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        adapter && adapter.setState && adapter.setState('connected', false, true);
        callback();
    } catch (e) {
        callback();
    }
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function () {
    main();
});

function main() {

    // The adapters config (in the instance object everything under the attribute "native") is accessible via
    // adapter.config:
    adapter.log.info('config username: '    + adapter.config.username);
    adapter.log.info('config password: '    + adapter.config.password);

    // in this surepetcareio all states changes inside the adapters namespace are subscribed
    adapter.subscribeStates('*');
    adapter.setState('connected', false, true);

    do_login();
}

var privates = {};

function timeout_callback()
{
    get_control(function() {
        set_pets()
        setTimeout(timeout_callback, 10*1000);
    });
}

function build_options(path, method, token) {
    var options = {
        hostname: 'app.api.surehub.io',
        port: 443,
        path: path,
        method: method,
        headers: {
            "Host" : "app.api.surehub.io",
            "Accept" : "application/json, text/plain, */*",
            "Referer" : "https://surepetcare.io/",
            "Content-Type" : "application/json;charset=utf-8",
            "Origin" :  "https://surepetcare.io",
        }
    };

    if (token != undefined) {
        options.headers["Authorization"] = 'Bearer ' + token;
    }

    return options;
}

function do_request(tag, options, postData, callback) {
    var req = https.request(options, (res) => {
        adapter.log.debug(tag +' statusCode: ' + res.statusMessage + '(' +  res.statusCode + ')');
        adapter.log.debug(tag + 'headers:' + util.inspect(res.headers, false, null, true /* enable colors */));
    
        if (res.statusCode !== 200) {
            adapter.log.debug("status code not OK!");
            do_login();
        }

        var data = [];
        res.on('data', (chunk) => {
            data.push(chunk);
        });
        res.on('data', () => {
            try {
                var obj = JSON.parse(data.join(''));
                adapter.log.debug(util.inspect(obj, false, null, true /* enable colors */));
                callback(obj);
            } catch(err) {
                adapter.log.debug(err.message);
                adapter.log.debug('error in ' + data.toString());
                do_login();
            }
        });
    });

    req.on('error', (e) => {
        adapter.log.error(e);
        do_login();
    });

    req.write(postData);
    req.end();
}

function do_login() {
    privates = {};
    numberOfLogins++;
    console.info('trying to login (' + numberOfLogins + ')...');
    login(adapter.config.username, adapter.config.password, get_household);
}

function login(username, password, callback) {
  var postData = JSON.stringify( { 'email_address':username,'password':password, 'device_id':'1050547954'} );
  var options = build_options('/api/auth/login', 'POST');

  do_request('login', options, postData, function(obj) {
    if (obj == undefined || obj.data == undefined || !('token' in obj.data)) {
        adapter.log.info('no token in adapter, retrying login in 5 secs...');
        setTimeout(do_login, 5*1000);
    } else {
        var token = obj.data['token'];
        privates['token'] = token;
        callback();
    }
  })
}

function get_household() {
    var options = build_options('/api/household?with[]=household', 'GET', privates['token']);
    do_request('get_household', options, '', function(obj) {
        privates['household'] = obj.data[0]['id'];
        adapter.setState('connected',true, true, function(err) {
            adapter.log.info('connected...');
            setTimeout(timeout_callback, 100);
        });
    });
}

function set_pets() {
    var len = privates.pets.length;
    for (var i = 0; i < len; i++) {
        var name = privates.pets[i].name;
        var where = privates.pets[i].position.where;
        var since = privates.pets[i].position.since;
        adapter.log.info(name + ' is ' + where + ' since ' + prettyMs(Date.now() - new Date(since)));

        var prefix = 'household' + privates.pets[i].household_id + '.pets';
        adapter.setObject(prefix, {
            type: 'channel',
            common: {
                name: 'Pets in household ' + privates.pets[i].household_id,
                role: 'info'
            },
            native: {}
        });

        var obj_name = prefix + '.' + i;
        adapter.setObject(obj_name, {
            type: 'state',
            common: {
                name: name,
                type: 'boolean',
                role: 'indicator',
                icon: 'surepetcareio.png',
                read: true,
                write: false
            },
            native: {}
        });

        adapter.setState(obj_name, (where == 1) ? true : false, true);
    }
}

function set_status() {
    for(var h = 0; h < privates.households.length; h++) {
        var prefix = 'household' + privates.households[h].id + '.devices';
       
        adapter.setObject(prefix, {
            type: 'channel',
            common: {
                name: 'Devices in household ' + privates.households[h].id,
                role: 'info'
            },
            native: {}
        });
       
        for(var d = 0; d < privates.devices.length; d++) {
            if (privates.devices[d].household_id ==  privates.households[h].id) {
                var obj_name =  prefix + '.' + privates.devices[d].name;
                adapter.setObject(obj_name, {
                    type: 'channel',
                    common: {
                        name: privates.devices[d].name,
                        role: ''
                    },
                    native: {}
                });

                if ('parent' in privates.devices[d]) {
                    // locking status
                    var obj_name =  prefix + '.' + privates.devices[d].name + '.' + 'locking';
                    adapter.setObject(obj_name, {
                        type: 'state',
                        common: {
                            name: 'locking',
                            role: 'indicator',
                            type: 'number',
                            read: true,
                            write: false,
                            states: {0: 'OPEN', 1:'LOCKED INSIDE', 2:'LOCKED OUTSIDE', 3:'LOCKED BOTH', 4:'CURFEW' }
                        },
                        native: {}
                    });
                    adapter.setState(obj_name, privates.devices[d].status.locking.mode, true);

                    // battery status
                    obj_name =  prefix + '.' + privates.devices[d].name + '.' + 'battery';
                    adapter.setObject(obj_name, {
                        type: 'state',
                        common: {
                            name: 'battery',
                            role: 'indicator',
                            type: 'number',
                            read: true,
                            write: false,
                        },
                        native: {}
                    });
                    adapter.setState(obj_name, privates.devices[d].status.battery, true);
                } else {
                    var obj_name =  prefix + '.' + privates.devices[d].name + '.' + 'led_mode';
                    adapter.setObject(obj_name, {
                        type: 'state',
                        common: {
                            name: 'led_mode',
                            role: 'indicator',
                            type: 'number',
                            read: true,
                            write: false,
                            states: {0: 'OFF', 1:'HIGH', 4:'DIMMED' }
                        },
                        native: {}
                    });
                    adapter.setState(obj_name, privates.devices[d].status.led_mode, true);
                }
                // online status
                obj_name =  prefix + '.' + privates.devices[d].name + '.' + 'online';
                adapter.setObject(obj_name, {
                    type: 'state',
                    common: {
                        name: 'online',
                        role: 'indicator',
                        type: 'boolean',
                        read: true,
                        write: false,
                    },
                    native: {}
                });
                adapter.setState(obj_name, privates.devices[d].status.online, true);
            }                
        }
    }
}

function get_control(callback) {
    var options = build_options('/api/me/start', 'GET', privates['token']);
    do_request('get_control', options, '', function(obj) {
        privates.devices = obj.data.devices;
        privates.households = obj.data.households;
        privates.pets = obj.data.pets;

        set_status();

        callback();
    });
}

