import { Router } from 'express';
import { requireAuth } from './require-auth.js';
import { registerUserHandler } from '../handler/register-user-handler.js';
import { loginUserHandler } from '../handler/login-user-handler.js';
import { steamConnectHandler } from '../handler/steam-connect-handler.js';
import { steamDisconnectHandler } from '../handler/steam-disconnect-handler.js';
import { steamLoginHandler } from '../handler/steam-login-handler.js';
import { validateUserHandler } from '../handler/validate-user-handler.js';
import { updateSelfHandler } from '../handler/update-self-handler.js';
import { deleteSelfHandler } from '../handler/delete-self-handler.js';
import { logoutHandler } from '../handler/logout-handler.js';
import { generateApiTokenHandler } from '../handler/generate-api-token-handler.js';

const authRouter = Router();

authRouter.post('/register', registerUserHandler);
authRouter.post('/login', loginUserHandler);
authRouter.post('/steam-connect', requireAuth, steamConnectHandler);
authRouter.post('/steam-disconnect', requireAuth, steamDisconnectHandler);
authRouter.post('/steam', steamLoginHandler);
authRouter.get('/validate', requireAuth, validateUserHandler);
authRouter.patch('/self', requireAuth, updateSelfHandler);
authRouter.delete('/self', requireAuth, deleteSelfHandler);
authRouter.post('/api-token', requireAuth, generateApiTokenHandler);
authRouter.post('/logout', logoutHandler);

export default authRouter;
