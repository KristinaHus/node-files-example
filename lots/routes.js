'use strict';

const express = require('express'),
  pick = require('lodash/fp/pick'),
  moment = require('moment'),
  adminOnly = require('../users/admin-middleware'),
  Auction = require('../auctions/model'),
  Bid = require('../bids/model'),
  AutoBid = require('../auto-bid/model'),
  authenticate = require('../users/authenticate-middleware'),
  Lot = require('./model'),
  log = require('../util/log')(module),
  lotValidator = require('./validator'),
  notFound = require('../web/not-found'),
  loader = require('../images/loader'),
  pictureAdder = require('./picture-adder'),
  mediaAdder = require('./media-adder'),
  documentAdder = require('./document-adder'),
  validate = require('../web/validate-middleware'),
  toJson = require('./toJson'),
  validateImage = require('../images/validate-image-middleware'),
  lotIoSender = require('../lots/io-sender'),
  eventEmitter = require('./../util/eventEmitter'),
  extendLotByPublicIds = require('./public-id').extendLotByPublicIds,
  extendLotsByPublicIds = require('./public-id').extendLotsByPublicIds,
  config = require('../config');

const router = express.Router();

router.param('lotId', (req, res, next, lotId) => {
  Lot.findById(lotId)
    .then(notFound)
    .then(lot => {
      req.lot = lot;
      next();
    })
    .catch(next);
});

let canEdit = (req, res, next) => {
  if (!req.lot.createdBy.equals(req.user._id) && !adminOnly.isAdmin(req)) {
    return next(new adminOnly.NotAuthorized());
  }
  if (!req.lot.draft) {
    return next({
      name: 'ValidationError',
      errors: {
        'Cant\'t be edited': {
          message: 'Only draft lots can be edited'
        }
      }
    });
  }
  return next();
};

let lotsQuery = (req) => {
  let q = {};
  if (req.query.filters) {
    // catch errors in parsing
    try {
      q = Object.assign(q, JSON.parse(req.query.filters));
    } catch (err) {}
  }
  if (req.query.draft === 'all') {
    return q;
  } else if (req.user) {
    if (req.query.draft) {
      q.draft = true;
      q.createdBy = req.user._id;
    } else {
      q.$or = [{draft: false}, {createdBy: req.user._id}];
    }
  } else {
    q.draft = false;
  }
  q.state = {$in: ['future', 'open', 'live']};
  return q;
};

router.get('/lots', authenticate.allowAnonymous, (req, res, next) => {
  let q = lotsQuery(req);

  Lot.find(q, toJson.myPublicFieldsProjection)
    .sort(req.query.sortField && req.query.sortDirection ? {[req.query.sortField]: req.query.sortDirection} : {})
    .limit(+req.query.limit)
    .skip((req.query.page - 1) * (+req.query.limit))
    .then(pictureAdder(req.query))
    .then(extendLotsByPublicIds)
    .then(lots => {
      return Lot.count(q)
        .then(count => {
          res.set('X-Total-Count', count);
          res.set('X-Total-Pages', Math.ceil((count || 1) / req.query.limit));
          res.set('X-Current-Page', req.query.page || 1);
          return lots;
        });
    })
    .then(lots => {
      res.json({
        lots: toJson.lots(req)(lots)
      });
    })
    .catch(next);
});

router.get('/auctions/:auctionId/lots', authenticate.allowAnonymous, (req, res, next) => {
  let q = lotsQuery(req);
  q.auction = req.params.auctionId;

  Lot.find(q, toJson.myPublicFieldsProjection)
    .populate('auction', 'standbyTimer')
    .then(pictureAdder(req.query))
    .then(extendLotsByPublicIds)
    .then(lots => {
      let promises = lots.map((lot, index) => {
        return Bid.aggregate(
          [
            {
              $lookup: {
                from: "auctions",
                localField: "auction",
                foreignField: "_id",
                as: "auction_doc"
              }
            },
            {
              $match: {lot: lot._id}
            },
            {
              $group: {
                _id: {auction: "$auction", createdBy: "$createdBy", auction_doc: "$auction_doc"},
              }
            }
          ]
        )
          .then(bids => {
            let participants = [];
            for (let i = 0; i < bids.length; i++) {
              if (bids[i]._id && bids[i]._id.auction_doc[0] && bids[i]._id.auction_doc[0].state !== 'closed') {
                if (!participants.some(el => el === bids[i]._id.createdBy)) {
                  participants.push(bids[i]._id.createdBy);
                }
              }
            }
            lot.participants = participants
            return lot
          })
          .catch(err => {
            console.log('GET BIDS ERR', err);
          });
      })
      return Promise.all(promises)
    })
    .then(lots => {
      res.json({
        lots: toJson.lots(req)(lots)
      });
    })
    .catch(next);
});

router.get('/auctions/:auctionId/results', authenticate.allowAnonymous, (req, res, next) => {
  let q = lotsQuery(req);
  q.auction = req.params.auctionId;
  q.state = 'closed';

  Lot.find(q, toJson.myPublicFieldsProjection)
    .then(pictureAdder(req.query))
    .then(extendLotsByPublicIds)
    .then(lots => {
      res.json({
        lots: toJson.lots(req)(lots)
      });
    })
    .catch(next);
});

router.post('/auctions/:auctionId/lots', authenticate, function (req, res, next) {
  if (req.body.lot.draft) {
    validate(lotValidator.createDraft)(req,res,next)
  } else {
    if (req.body.lot.platform === 'web-app') {
      validate(lotValidator.createWeb)(req,res,next)
    } else {
      validate(lotValidator.create)(req,res,next)
    }

  }
}, (req, res, next) => {
  let lot, auction;
  Auction.findById(req.params.auctionId, '_id liveAt lotOpeningSeconds kind state lotMaxSeconds auctionMaxSeconds')
    .populate('kind')
    .then(notFound)
    .then(_auction => {
      auction = _auction;
      return new Promise((resolve, reject) => {
        validate(lotValidator.createForKind(auction.kind, req.body.lot.draft))(req, res, err => {
          if (auction.state === 'closed') {
            return reject({
              name: 'ValidationError',
              errors: {
                'Auction state': {
                  message: 'Auction closed'
                }
              }
            });
          }
          if (err) {
            return reject(err);
          }
          req.body.lot.auction = auction._id;
          req.body.lot.state = auction.state;
          req.body.lot.createdBy = req.user._id;
          req.body.lot.lotMaxSeconds = auction.lotMaxSeconds;
          req.body.lot.finishAt = moment(auction.liveAt).add(auction.lotOpeningSeconds, 'seconds');
          req.body.lot.shouldClose = moment(auction.liveAt).add(auction.auctionMaxSeconds, 'seconds');
          resolve(true);
        });
      });
    })
    .then(() => {
      lot = new Lot(req.body.lot);
      return lot.save();
    })
    .then(pictureAdder(req.query))
    .then(() => {
      Lot.find({
        'auction': req.body.lot.auction
      }).then(lots => {
        let counts = {};

        lots
          .filter(lot => !lot.draft)
          .forEach(lot => {
            if (!counts[lot.bidding]) {
              counts[lot.bidding] = lot.count;
            } else {
              counts[lot.bidding] += lot.count;
            }
          });
        log.debug('auction counts', JSON.stringify([counts, auction._id]));
        Auction.findOneAndUpdate({_id: auction._id}, {counts: counts}, {new: true}).then(auction => {
        });
      });

      log.info('New Lot:', JSON.stringify(lot));
      res.json({
        lot: toJson.lot(req)(extendLotByPublicIds(lot))
      });
      eventEmitter.emit('lot_edit', lot);
    })
    .catch(next);
});

router.get('/lots/:lotId', authenticate, (req, res) => {
  res.json({
    lot: toJson.lot(req)(extendLotByPublicIds(pictureAdder(req.query)(req.lot)))
  });
});

router.put('/lots/:lotId', authenticate, canEdit, function (req, res, next) {
  if (req.body.lot.draft) {
    validate(lotValidator.updateDraft)(req,res,next)
  } else {
    if (req.body.lot.platform === 'web-app') {
      validate(lotValidator.updateWeb)(req,res,next)
    } else {
      validate(lotValidator.update)(req,res,next)
    }

  }
}, (req, res, next) => {
  Lot.findByIdAndUpdate({_id: req.params.lotId}, req.body.lot, {
    new: true,
    runValidators: true,
    context: 'query'
  })
    .then(notFound)
    .then(pictureAdder(req.query))
    .then(_lot => {

      let counts = {};
      Lot.find({
        'auction': _lot.auction
      }).then(lots => {
        lots
          .filter(lot => !lot.draft)
          .forEach(function (lot) {
            if (!counts[lot.bidding]) {
              counts[lot.bidding] = lot.count;
            } else {
              counts[lot.bidding] += lot.count;
            }
          });
        Auction.findOneAndUpdate({_id: _lot.auction}, {counts: counts}, {new: true}).then(auction => {
        });
      });

      res.json({
        lot: toJson.lot(req)(extendLotByPublicIds(_lot))
      });
      eventEmitter.emit('lot_edit', _lot);
    })
    .catch(next);
});

router.delete('/lots/:lotId', (req, res, next) => {

  Lot.findById(req.params.lotId).then(_lot => {
    if (!_lot)  throw new notFound.NotFoundError();

    return Lot.remove({_id: _lot._id})
      .then(result => {
        if (result.result.n === 0) {
          throw new notFound.NotFoundError();
        }

        let counts = {};
        Lot.find({
          'auction': _lot.auction.id
        }).then(lots => {
          lots
            .filter(lot => !lot.draft)
            .forEach(function (lot) {
              if (!counts[lot.bidding]) {
                counts[lot.bidding] = lot.count;
              } else {
                counts[lot.bidding] += lot.count;
              }
            });
          Auction.findOneAndUpdate({_id: _lot.auction.id}, {counts: counts}, {new: true}).then(auction=> {
          });
        });


        lotIoSender.sendToAll('delete', req.params.lotId);
        res.json(null);
      })

  })
    .catch(next);
});


router.post('/lots/:lotId/media', authenticate, canEdit, (req, res, next) => {
  let key;

  loader.uploadMedia(req, req.headers['content-type'])
    .then(_data => {
      key = _data.Key;
      req.lot.mediaKeys.push({key: key, mediaType: req.headers['content-type'], location: _data.Location});
      req.lot.save();
      return req.lot;
    })
    .then(mediaAdder(req.lot))
    .then((media) => {

      req.lot.media = media.data;
      req.lot.save()
      res.json(req.lot.media);
    })
    .catch(next);
})

router.post('/lots/:lotId/media/:mediaId/thumbnail', authenticate, canEdit, (req, res, next) => {
  let key;
  loader.uploadThumbnail(req, req.headers['content-type'])
    .then(_data => {
      for (let i = 0; i < req.lot.media.length; i++) {
        if (req.lot.media[i]._id.toString() === req.params.mediaId) {
          req.lot.media[i].thumbnail = `${config.media.endpoint}/${_data.key}`;
          res.json(req.lot.media[i]);
          break;
        }
      }
      req.lot.save()
    })

})

router.post('/lots/:lotId/documents', authenticate, canEdit, (req, res, next) => {
  let key;
  loader.uploadDocument(req, req.headers['content-type'])
    .then(_data => {
      key = _data.Key;
      req.lot.documentKeys.push({key: key, location: _data.Location});

      req.lot.save();
      return req.lot;
    })
    .then(documentAdder(req.headers['file-name']))
    .then((docs) => {
      // docs.data.name = req.headers['file-name'];
      req.lot.documents = docs.data;
      req.lot.save()
      res.json(docs);
    })
    .catch(next);
})

router.delete('/lots/:lotId/documents/:documentKey', authenticate, canEdit, (req, res, next) => {
  loader.delete(req.params.documentKey)
    .then(() => {
      req.lot.documentKeys = req.lot.documentKeys.filter(key => key.key !== req.params.documentKey);
      req.lot.documents = req.lot.documents.filter(document => document.key !== req.params.documentKey);
      return req.lot.save();
    })
    .then(() => {
      res.json({documents: req.lot.documents});
    })
    .catch(next);
});

router.get('/lots/bids/:lotId/:auctionId', authenticate, (req, res, next) => {
  let q = {
    createdBy: req.user._id
  };
  if (req.query.lot) {
    q.lot = new ObjectId(req.params.lotId);
  }

  AutoBid.aggregate(
    [
      {
        $lookup: {
          from: "lots",
          localField: "lot",
          foreignField: "_id",
          as: "lot_doc"
        }
      },
      {$match: q},
      {
        $group: {
          _id: {lot: "$lot", lot_doc: "$lot_doc"},
          maxCost: {$max: "$cents"},
        }
      }
    ]
  )
    .then(autobids => {
      autobids = autobids.reduce((lot, item)=> {
        if (item._id.lot_doc[0] && item._id.lot_doc[0].state !== 'closed') {
          lot[item._id.lot] = item.maxCost;
        }
        return lot;
      }, {});
      return autobids;
    })
    .then(autobids => {
      if (req.query.auction) {
        q.auction = new ObjectId(req.params.auctionId);
      }
      return Bid.aggregate(
        [
          {
            $lookup: {
              from: "auctions",
              localField: "auction",
              foreignField: "_id",
              as: "auction_doc"
            }
          },
          {$match: q},
          {
            $group: {
              _id: {auction: "$auction", lot: "$lot", auction_doc: "$auction_doc"},
              maxCost: {$max: "$cents"},
            }
          }
        ]
      )
        .then(bids => {
          bids = bids.reduce((auction, item)=> {
            if (item._id.auction_doc[0] && item._id.auction_doc[0].state !== 'closed') {
              if (!auction[item._id.auction]) {
                auction[item._id.auction] = {}
              }
              auction[item._id.auction][item._id.lot] = item.maxCost;
            }
            return auction;
          }, {});
          res.json({
            bids,
            autobids
          });
        });
    })
    .catch(next);
});

module.exports = router;
