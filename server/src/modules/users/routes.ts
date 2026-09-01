import { Router } from "express";
import { prisma } from "../../db/client.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validateBody } from "../../middleware/validate.js";
import { updateMeSchema } from "./schemas.js";

function toPublicUser(user: {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
  };
}

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get("/me", async (req, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id } });
    res.status(200).json(toPublicUser(user));
  } catch (err) {
    next(err);
  }
});

usersRouter.patch("/me", validateBody(updateMeSchema), async (req, res, next) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: req.body,
    });
    res.status(200).json(toPublicUser(user));
  } catch (err) {
    next(err);
  }
});
