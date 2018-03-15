'use strict';

const ajv = require('ajv')(),
  cloneDeep = require('lodash/cloneDeep');

let userSchema = {
  type: 'object',
  properties: {
    user: {
      type: 'object',
      properties: {
        name: {
          type: 'string'
        },
        firstName: {
          type: 'string'
        },
        lastName: {
          type: 'string'
        },
        email: {
          type: 'string',
          format: 'email'
        },
        website: {
          type: 'string',
        },
        password: {
          type: 'string',
          maxLength: 50,
          minLength: 6
        },
        phone: {
          type: 'string'
        },
        secondaryPhone: {
          type: 'string'
        },
        role: {
          type: 'string',
          enum: ['user']
        },
        type: {
          type: 'string',
          enum: ['seller', 'buyer']
        },
        sellerType: {
          type: 'string',
          enum: ['independent', 'agency']
        },
        agencyName: {
          type: 'string'
        },
        PIC: {
          type: 'string'
        },
        ABN: {
          type: 'string'
        },
        SSPermitNumber: {
          type: 'string'
        },
        SSPermitNumberAge: {
          type: 'string'
        },
        settings: {
          type: 'object'
        },
        tradingName: {
          type: 'string'
        },
        saleConditions: {
          type: 'string'
        },
        watchList: {
          type: 'object',
          patternProperties: {
            '^[a-f\\d]{24}$': {
              type: 'array',
              items: {
                type: 'string',
                pattern: '^[a-f\\d]{24}$'
              }
            }
          },
          additionalProperties: false
        },
        propertyAddress: {
          type: 'object',
          properties: {
            name: {
              type: 'string'
            },
            address: {
              type: 'string'
            },
            town: {
              type: 'string'
            },
            postcode: {
              type: 'string',
            }
          },
          required: ['town', 'postcode'],
          additionalProperties: false
        },
        postalAddress: {
          type: 'object',
          properties: {
            name: {
              type: 'string'
            },
            address: {
              type: 'string'
            },
            town: {
              type: 'string'
            },
            postcode: {
              type: 'string',
            }
          },
          required: ['town', 'postcode'],
          additionalProperties: false
        }
      },
      required: ['firstName', 'lastName', 'email', 'password'],
      additionalProperties: false
    }
  },
  required: ['user'],
  additionalProperties: false
};

let validatePost = ajv.compile(userSchema);

function createAdminValidator(schema) {
  let adminUserSchema = cloneDeep(schema);
  adminUserSchema.properties.user.properties.role.enum.push('admin');
  return ajv.compile(adminUserSchema);
}

let validateAdminPost = createAdminValidator(userSchema);

let updateUserSchema = cloneDeep(userSchema);
delete updateUserSchema.properties.user.required;

let validatePut = ajv.compile(updateUserSchema);

let validateAdminPut = createAdminValidator(updateUserSchema);

let changePasswordSchema = {
  type: 'object',
  properties: {
    password: {
      type: 'string',
      maxLength: 50,
      minLength: 6
    }
  },
  required: ['password'],
  additionalProperties: false
};
let validateChangePassword = ajv.compile(changePasswordSchema);

let forgotPasswordSchema = {
  type: 'object',
  properties: {
    email: {
      type: 'string',
      format: 'email'
    }
  },
  required: ['email'],
  additionalProperties: false
};
let validateForgotPassword = ajv.compile(forgotPasswordSchema);

module.exports.create = isAdmin => isAdmin ? validateAdminPost : validatePost;
module.exports.update = isAdmin => isAdmin ? validateAdminPut : validatePut;
module.exports.changePassword = validateChangePassword;
module.exports.forgotPassword = validateForgotPassword;

module.exports.io = {
  login: ajv.compile({
    type: 'object',
    properties: {
      'x-api-key': {
        type: 'string'
      }
    },
    required: ['x-api-key'],
    additionalProperties: false
  })
};
