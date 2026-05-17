import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import detectionsRouter from "./detections";
import statsRouter from "./stats";
import streamRouter from "./stream";
import monitorsRouter from "./monitors";
import alertsRouter from "./alerts";
import accountRouter from "./account";
import uploadRouter from "./upload";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(detectionsRouter);
router.use(statsRouter);
router.use(streamRouter);
router.use(monitorsRouter);
router.use(alertsRouter);
router.use(accountRouter);
router.use(uploadRouter);

export default router;
