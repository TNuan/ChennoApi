import express from 'express';
import { WorkspaceController } from '../controllers/workspaceController.js';
import authenticateToken from '../middleware/authMiddleware.js';
import { body, validationResult } from 'express-validator';

const router = express.Router();

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

router.post(
    '/',
    authenticateToken,
    [
        body('name').notEmpty().withMessage('Tên workspace là bắt buộc'),
    ],
    validate,
    WorkspaceController.create
);

router.get('/', authenticateToken, WorkspaceController.getAll);

router.get('/:id', authenticateToken, WorkspaceController.getById);

router.put(
    '/:id',
    authenticateToken,
    [
        body('name').notEmpty().withMessage('Tên workspace là bắt buộc'),
    ],
    validate,
    WorkspaceController.update
);

router.delete('/:id', authenticateToken, WorkspaceController.remove);

router.post(
    '/:id/members',
    authenticateToken,
    [
        body('userId').isInt().withMessage('ID người dùng phải là số'),
        body('role').optional().isIn(['admin', 'member']).withMessage('Vai trò phải là admin hoặc member'),
    ],
    validate,
    WorkspaceController.inviteMember
);

router.post(
    '/:id/bulk-invite',
    authenticateToken,
    [
        body('userIds').isArray().withMessage('userIds phải là một mảng'),
        body('userIds.*').isInt().withMessage('Tất cả ID người dùng phải là số'),
        body('role').optional().isIn(['admin', 'member']).withMessage('Vai trò phải là admin hoặc member'),
    ],
    validate,
    WorkspaceController.inviteMembers
);

router.delete('/:id/members/:userId', authenticateToken, WorkspaceController.removeMember);

router.get('/:id/members', authenticateToken, WorkspaceController.getMembersList);

router.put(
    '/:id/members/:userId',
    authenticateToken,
    [
        body('role').isIn(['admin', 'member']).withMessage('Vai trò phải là admin hoặc member'),
    ],
    validate,
    WorkspaceController.updateMember
);

export default router;