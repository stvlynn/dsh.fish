/**
 * The Redis client the Node runtime uses, re-exported so the site's server
 * entry and its tests bind to the same driver the backend owns, rather than
 * each package declaring its own copy of it.
 */
export { Redis } from 'ioredis'
