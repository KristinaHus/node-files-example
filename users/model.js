'use strict';

const emailValidator = require('email-validator').validate,
  mongoose = require('mongoose'),
  mongooseBcrypt = require('mongoose-bcrypt'),
  mongooseUniqueValidator = require('mongoose-unique-validator'),
  uuid = require('uuid'),
  autoIncrement = require('mongoose-auto-increment'),
  createdAt = require('../schema/createdAt'),
  makeEnum = require('../schema/makeEnum');

const userSchema = new mongoose.Schema({
  name:  String,
  firstName: {
    type: String,
    required: true
  },
  lastName: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    validate: {validator: emailValidator},
    unique: true
  },
  website: {
    type: String,
    default: null
  },
  password: {
    type: String,
    required: true,
    bcrypt: true
  },
  sellerType: makeEnum(['independent', 'agency'], 'independent', false),
  agencyName: {
    type: String,
    default: null
  },
  PIC: {
    type: String,
    required: true
  },
  ABN: {
    type: String,
    required: true
  },
  SSPermitNumber: {
    type: String,
    default: null
  },
  SSPermitNumberOfYears: {
    type: String,
    default: null
  },
  tradingName: {
    type: String,
    required: true,
  },
  phone: {
    type: String,
    required: true
  },
  secondaryPhone: {
    type: String,
    default: null
  },
  role: makeEnum(['user', 'admin']),
  type: makeEnum(['seller', 'buyer']),
  apiKey: {
    type: String,
    required: true,
    default: uuid.v4
  },
  watchList: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    default: {}
  },
  bids: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    default: {}
  },
  numericId: {
    type: Number
  },
  settings: {
    pushPermissions: {
      lot_closed: {
        type: Boolean,
        required: false,
        default: true
      },
      lot_lost: {
        type: Boolean,
        required: false,
        default: true
      }
    }
  },
  propertyAddress: {
    name: {
      type: String,
      default: null
    },
    address: {
      type: String,
      default: null
    },
    town: {
      type: String,
      required: true,
    },
    postcode: {
      type: String,
      required: true,
    }
  },
  postalAddress: {
    name: {
      type: String,
      default: null
    },
    address: {
      type: String,
      default: null
    },
    town: {
      type: String,
      required: true,
    },
    postcode: {
      type: String,
      required: true,
    }
  },
  saleConditions: {
    type: String,
    default: null
  },
  createdAt,
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  SSPermitFile: {
    key: {
      type: String
    },
    mediaType: {
      type: String
    },
    url: {
      type: String
    }
  },
  identityPolicyFile: {
    key: {
      type: String
    },
    url: {
      type: String
    },
  },
  fileKeys: [{
    key: {
      type: String
    },
    location: {
      type: String
    }
  }],
});

userSchema.virtual('shortId').get(function () {
  if (this.numericId) {
    return String('000000' + this.numericId).slice(-6);
  } else {
    return "";
  }
});

userSchema.plugin(mongooseBcrypt);
userSchema.plugin(mongooseUniqueValidator);

userSchema.path('firstName').validate(name => name.length <= 255, 'MaxLength error', 255);

autoIncrement.initialize(mongoose.connection);

const User = mongoose.model('User', userSchema);

module.exports = User;

userSchema.plugin(autoIncrement.plugin, {model: 'User', field: 'numericId', startAt: 400});
