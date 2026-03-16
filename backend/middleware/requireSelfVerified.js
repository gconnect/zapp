export default function requireSelfVerified(req, res, next) {

  if (!req.user.self_verified) {
    return res.status(403).json({
      error: "Complete Self verification first"
    });
  }

  next();
}