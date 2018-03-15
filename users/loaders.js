'use strict';

const AWS = require('aws-sdk'),
  uuid = require('uuid'),
  log = require('../util/log')(module),

  config = require('../config/index');

let s3 = new AWS.S3({
  params: {
    Bucket: config.images.bucket
  }
});

let loader = {};

loader.uploadFile = (dataStream, mime) => {
  return new Promise((resolve, reject) => {
    let key = uuid.v4();
    s3.upload({
      Key: key,
      Body: dataStream,
      ContentType: mime
    }, (err, data) => {
      if (err) {
        return reject(err);
      }
      data.contentType = mime
    resolve(data);
  });
});
};

loader.delete = (key) => {
  return new Promise((resolve, reject) => {
    s3.deleteObject({
      Key: key,
      }, (err, data) => {
        if (err) {
          return reject(err);
        }
        resolve(key);
    });
  });
};

module.exports = loader;
