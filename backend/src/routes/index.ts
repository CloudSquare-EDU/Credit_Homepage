/**
 * 라우트 통합
 */

import { Router } from 'express';
import authRoutes from './auth';
import courseRoutes from './courses';
import accountRoutes from './accounts';
import monitoringRoutes from './monitoring';
import cleanupRoutes from './cleanup';

const router = Router();

router.use('/auth', authRoutes);
router.use('/courses', courseRoutes);
router.use('/accounts', accountRoutes);
router.use('/monitoring', monitoringRoutes);
router.use('/cleanup', cleanupRoutes);

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

export default router;
