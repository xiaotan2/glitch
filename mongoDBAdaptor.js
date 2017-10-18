// Code from https://mongodb-sync.glitch.me for reference

"use strict";

var MongoClient = require('mongodb').MongoClient;
var assert = require('assert');
var url = 'mongodb://'+process.env.USER+':'+process.env.PASS+"@cluster0-shard-00-00-ykskw.mongodb.net:27017,cluster0-shard-00-01-ykskw.mongodb.net:27017,cluster0-shard-00-02-ykskw.mongodb.net:27017/"+process.env.DB+"?ssl=true&replicaSet=Cluster0-shard-0&authSource=admin";
var collection;

// Data example format:
// {"intent":"name", "response":"my name is Alex."}

function set(key, value) {
  return new Promise(function (resolve, reject) {
    if (typeof(key) !== "string") {
      reject(new DatastoreKeyNeedToBeStringException(key));
    } else {
      try {
        collection.updateOne({"intent": key, "response": value}, {upsert:true}, function (err, res) {
          if (err) {
            reject(new DatastoreUnderlyingException(value, err));
          } else {
            resolve(res);
          }
        });
      } catch (ex) {
        reject(new DatastoreValueSerializationException(value, ex));
      }
    }
  });
}

function get(key) {
  return new Promise(function (resolve, reject) {
    try {
      if (typeof(key) !== "string") {
        reject(new DatastoreKeyNeedToBeStringException(key));
      } else {
        collection.findOne({"intent":key}, function (err, data) {
          if (err) {
            reject(new DatastoreUnderlyingException(key, err));
          } else {
            try {
              if(data===null){
                resolve(null);
              }
              else{
                resolve(data.response);
              }
            } catch (ex) {
              reject(new DatastoreDataParsingException(data.value, ex));
            }
          }
        });
      }
    } catch (ex) {
      reject(new DatastoreUnknownException("get", {"intent": key}, ex));
    }
  });
}

function remove(key) {
  return new Promise(function (resolve, reject) {
    try {
      if (typeof(key) !== "string") {
        reject(new DatastoreKeyNeedToBeStringException(key));
      } else {
        collection.deleteOne({"intent": key}, function (err, res) {
          if (err) {
            reject(new DatastoreUnderlyingException(key, err));
          } else {
            resolve(res);
          }
        });
      }
    } catch (ex) {
      reject(new DatastoreUnknownException("remove", {"intent": key}, ex));
    }
  });
}

function removeMany(keys) {
  return Promise.all(keys.map(function (key) {
    return remove(key);
  }));
}

function connect() {
  return new Promise(function (resolve, reject) {
    try {
      MongoClient.connect(url, function(err, db) {
        if(err) reject(err);
        collection = db.collection(process.env.COLLECTION);
        resolve(collection);
      });
    } catch(ex) {
      reject(new DatastoreUnknownException("connect", null, ex));
    }
  });
}

function DatastoreKeyNeedToBeStringException(keyObject) {
  this.type = this.constructor.name;
  this.description = "Datastore can only use strings as keys, got " + keyObject.constructor.name + " instead.";
  this.key = keyObject;
}

function DatastoreValueSerializationException(value, ex) {
  this.type = this.constructor.name;
  this.description = "Failed to serialize the value to JSON";
  this.value = value;
  this.error = ex;
}

function DatastoreDataParsingException(data, ex) {
  this.type = this.constructor.name;
  this.description = "Failed to deserialize object from JSON";
  this.data = data;
  this.error = ex;
}

function DatastoreUnderlyingException(params, ex) {
  this.type = this.constructor.name;
  this.description = "The underlying DynamoDB instance returned an error";
  this.params = params;
  this.error = ex;
}

function DatastoreUnknownException(method, args, ex) {
  this.type = this.constructor.name;
  this.description = "An unknown error happened during the operation " + method;
  this.method = method;
  this.args = args;
  this.error = ex;
}

// -------------------------------------------
// SYNCHRONOUS WRAPPERS AROUND THE PROMISE API
// -------------------------------------------

var sync = require("synchronize");

function setCallback(key, value, callback) {
  set(key, value)
    .then(function (value) {
      callback(null, value);
    })
    .catch(function (err) {
      callback(err, null);
    });
}

function getCallback(key, callback) {
  get(key)
    .then(function (value) {
      callback(null, value);
    })
    .catch(function (err) {
      callback(err, null);
    });
}

function removeCallback(key, callback) {
  remove(key)
    .then(function (value) {
      callback(null, value);
    })
    .catch(function (err) {
      callback(err, null);
    });
}

function removeManyCallback(keys, callback) {
  removeMany(keys)
    .then(function (value) {
      callback(null, value);
    })
    .catch(function (err) {
      callback(err, null);
    });
}

function connectCallback(callback) {
  connect()
    .then(function (value) {
      callback(null, value);
    })
    .catch(function (err) {
      callback(err, null);
    });
}

function setSync(key, value) {
  return sync.await(setCallback(key, value, sync.defer()));
}

function getSync(key) {
  return sync.await(getCallback(key, sync.defer()));
}

function removeSync(key) {
  return sync.await(removeCallback(key, sync.defer()));
}

function removeManySync(keys) {
  return sync.await(removeManyCallback(keys, sync.defer()));
}

function connectSync() {
  return sync.await(connectCallback(sync.defer()));
}

function initializeApp(app) {
  app.use(function (req, res, next) {
    sync.fiber(next);
  });
}

var asyncDatastore = {
  set: set,
  get: get,
  remove: remove,
  removeMany: removeMany,
  connect: connect
};

var syncDatastore = {
  set: setSync,
  get: getSync,
  remove: removeSync,
  removeMany: removeManySync,
  connect: connectSync,  
  initializeApp: initializeApp
};

module.exports = {
  async: asyncDatastore,
  sync: syncDatastore
};