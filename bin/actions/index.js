const create = require('./create');
const docker = require('./docker');
const k8s = require('./k8s');

module.exports = {
  ...create,
  ...docker,
  ...k8s,
};
