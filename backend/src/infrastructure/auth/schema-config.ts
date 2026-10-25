import { createAuth } from './auth.js'

/** Schema inspection has no runtime bindings; production only imports the factory. */
export const auth = createAuth()
