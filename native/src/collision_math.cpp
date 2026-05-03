#include "oracle/collision_math.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#if defined(ORACLE_ZENO_DEBUG) && ORACLE_ZENO_DEBUG
#include <iostream>
#endif

namespace oracle {

namespace {

double dot(Vec2 a, Vec2 b) { return a.x * b.x + a.y * b.y; }

double len_sq(Vec2 v) { return dot(v, v); }

double dot3(Vec3 a, Vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

double len_sq3(Vec3 v) { return dot3(v, v); }

}  // namespace

std::optional<std::pair<double, WallAxis>> earliest_wall_collision_time(
    Vec2 p,
    Vec2 v,
    double r,
    const VolumeBounds& b,
    double t_ref,
    double t_min) {
  double best_t = std::numeric_limits<double>::infinity();
  WallAxis best_wall = WallAxis::Left;

  if (v.x < -kEps) {
    const double T = t_ref + (b.minX + r - p.x) / v.x;
    const double dt = T - t_ref;
    if (T > t_min - kTimeEps && dt >= kMinPairDt && T < best_t) {
      best_t = T;
      best_wall = WallAxis::Left;
    }
  }
  if (v.x > kEps) {
    const double T = t_ref + (b.maxX - r - p.x) / v.x;
    const double dt = T - t_ref;
    if (T > t_min - kTimeEps && dt >= kMinPairDt && T < best_t) {
      best_t = T;
      best_wall = WallAxis::Right;
    }
  }
  if (v.y < -kEps) {
    const double T = t_ref + (b.minY + r - p.y) / v.y;
    const double dt = T - t_ref;
    if (T > t_min - kTimeEps && dt >= kMinPairDt && T < best_t) {
      best_t = T;
      best_wall = WallAxis::Top;
    }
  }
  if (v.y > kEps) {
    const double T = t_ref + (b.maxY - r - p.y) / v.y;
    const double dt = T - t_ref;
    if (T > t_min - kTimeEps && dt >= kMinPairDt && T < best_t) {
      best_t = T;
      best_wall = WallAxis::Bottom;
    }
  }

  if (!std::isfinite(best_t) || best_t >= std::numeric_limits<double>::infinity()) {
    return std::nullopt;
  }
  return std::make_pair(best_t, best_wall);
}

std::optional<std::pair<double, WallAxis>> earliest_wall_collision_time_3d(
    Vec3 p,
    Vec3 v,
    double r,
    const VolumeBounds& b,
    double t_ref,
    double t_min) {
  double best_t = std::numeric_limits<double>::infinity();
  WallAxis best_wall = WallAxis::Left;

  auto consider = [&](double vp, double pos, double lo, double hi, WallAxis w_lo, WallAxis w_hi) {
    if (vp < -kEps) {
      const double T = t_ref + (lo + r - pos) / vp;
      const double dt = T - t_ref;
      if (T > t_min - kTimeEps && dt >= kMinPairDt && T < best_t) {
        best_t = T;
        best_wall = w_lo;
      }
    }
    if (vp > kEps) {
      const double T = t_ref + (hi - r - pos) / vp;
      const double dt = T - t_ref;
      if (T > t_min - kTimeEps && dt >= kMinPairDt && T < best_t) {
        best_t = T;
        best_wall = w_hi;
      }
    }
  };

  consider(v.x, p.x, b.minX, b.maxX, WallAxis::Left, WallAxis::Right);
  consider(v.y, p.y, b.minY, b.maxY, WallAxis::Top, WallAxis::Bottom);
  consider(v.z, p.z, b.minZ, b.maxZ, WallAxis::NearZ, WallAxis::FarZ);

  if (!std::isfinite(best_t) || best_t >= std::numeric_limits<double>::infinity()) {
    return std::nullopt;
  }
  return std::make_pair(best_t, best_wall);
}

std::optional<std::pair<double, WallAxis>> earliest_wrap_crossing_time(
    Vec2 p,
    Vec2 v,
    const VolumeBounds& b,
    double t_ref,
    double t_min) {
  double best_t = std::numeric_limits<double>::infinity();
  WallAxis best_wall = WallAxis::Left;

  if (v.x < -kEps) {
    const double T = t_ref + (b.minX - p.x) / v.x;
    const double dt = T - t_ref;
    if (T > t_min - kTimeEps && dt >= kMinPairDt && T < best_t) {
      best_t = T;
      best_wall = WallAxis::Left;
    }
  }
  if (v.x > kEps) {
    const double T = t_ref + (b.maxX - p.x) / v.x;
    const double dt = T - t_ref;
    if (T > t_min - kTimeEps && dt >= kMinPairDt && T < best_t) {
      best_t = T;
      best_wall = WallAxis::Right;
    }
  }
  if (v.y < -kEps) {
    const double T = t_ref + (b.minY - p.y) / v.y;
    const double dt = T - t_ref;
    if (T > t_min - kTimeEps && dt >= kMinPairDt && T < best_t) {
      best_t = T;
      best_wall = WallAxis::Top;
    }
  }
  if (v.y > kEps) {
    const double T = t_ref + (b.maxY - p.y) / v.y;
    const double dt = T - t_ref;
    if (T > t_min - kTimeEps && dt >= kMinPairDt && T < best_t) {
      best_t = T;
      best_wall = WallAxis::Bottom;
    }
  }

  if (!std::isfinite(best_t) || best_t >= std::numeric_limits<double>::infinity()) {
    return std::nullopt;
  }
  return std::make_pair(best_t, best_wall);
}

std::optional<double> earliest_uniform_accel_axis_hit_dt(
    double acc,
    double v,
    double c,
    double t_ref,
    double t_min) {
  const double rel_floor = kMinPairDt;
  if (std::abs(acc) < kEps) {
    if (std::abs(v) < kEps) {
      return std::nullopt;
    }
    const double dt = -c / v;
    if (!(dt >= rel_floor - kTimeEps)) {
      return std::nullopt;
    }
    if (t_ref + dt <= t_min - kTimeEps) {
      return std::nullopt;
    }
    return dt;
  }
  const double disc = v * v - 2.0 * acc * c;
  if (disc < -kEps) {
    return std::nullopt;
  }
  const double sd = disc <= 0.0 ? 0.0 : std::sqrt(disc);
  const double t1 = (-v - sd) / acc;
  const double t2 = (-v + sd) / acc;
  double best = std::numeric_limits<double>::infinity();
  auto consider = [&](double dt) {
    if (!std::isfinite(dt)) {
      return;
    }
    if (dt < rel_floor - kTimeEps) {
      return;
    }
    if (t_ref + dt <= t_min - kTimeEps) {
      return;
    }
    best = std::min(best, dt);
  };
  consider(t1);
  consider(t2);
  if (!std::isfinite(best) || best >= std::numeric_limits<double>::infinity()) {
    return std::nullopt;
  }
  return best;
}

std::optional<std::pair<double, WallAxis>> earliest_wall_collision_time_2d_uniform_accel(
    Vec2 p,
    Vec2 v,
    Vec2 a,
    double r,
    const VolumeBounds& b,
    double t_ref,
    double t_min) {
  if (len_sq(a) < kEps * kEps) {
    return earliest_wall_collision_time(p, v, r, b, t_ref, t_min);
  }
  double best_t = std::numeric_limits<double>::infinity();
  WallAxis best_wall = WallAxis::Left;

  auto consider = [&](double acc, double vp, double pos, double target, WallAxis w) {
    const double c = pos - target;
    const auto dt = earliest_uniform_accel_axis_hit_dt(acc, vp, c, t_ref, t_min);
    if (!dt.has_value()) {
      return;
    }
    const double T = t_ref + *dt;
    if (T > t_min - kTimeEps && *dt >= kMinPairDt && T < best_t) {
      best_t = T;
      best_wall = w;
    }
  };

  consider(a.x, v.x, p.x, b.minX + r, WallAxis::Left);
  consider(a.x, v.x, p.x, b.maxX - r, WallAxis::Right);
  consider(a.y, v.y, p.y, b.minY + r, WallAxis::Top);
  consider(a.y, v.y, p.y, b.maxY - r, WallAxis::Bottom);

  if (!std::isfinite(best_t) || best_t >= std::numeric_limits<double>::infinity()) {
    return std::nullopt;
  }
  return std::make_pair(best_t, best_wall);
}

std::optional<std::pair<double, WallAxis>> earliest_wall_collision_time_3d_uniform_accel(
    Vec3 p,
    Vec3 v,
    Vec3 a,
    double r,
    const VolumeBounds& b,
    double t_ref,
    double t_min) {
  if (len_sq3(a) < kEps * kEps) {
    return earliest_wall_collision_time_3d(p, v, r, b, t_ref, t_min);
  }
  double best_t = std::numeric_limits<double>::infinity();
  WallAxis best_wall = WallAxis::Left;

  auto consider = [&](double acc,
                        double vp,
                        double pos,
                        double lo,
                        double hi,
                        WallAxis w_lo,
                        WallAxis w_hi) {
    const double c_lo = pos - (lo + r);
    const auto dt_lo = earliest_uniform_accel_axis_hit_dt(acc, vp, c_lo, t_ref, t_min);
    if (dt_lo.has_value()) {
      const double T = t_ref + *dt_lo;
      if (T > t_min - kTimeEps && *dt_lo >= kMinPairDt && T < best_t) {
        best_t = T;
        best_wall = w_lo;
      }
    }
    const double c_hi = pos - (hi - r);
    const auto dt_hi = earliest_uniform_accel_axis_hit_dt(acc, vp, c_hi, t_ref, t_min);
    if (dt_hi.has_value()) {
      const double T = t_ref + *dt_hi;
      if (T > t_min - kTimeEps && *dt_hi >= kMinPairDt && T < best_t) {
        best_t = T;
        best_wall = w_hi;
      }
    }
  };

  consider(a.x, v.x, p.x, b.minX, b.maxX, WallAxis::Left, WallAxis::Right);
  consider(a.y, v.y, p.y, b.minY, b.maxY, WallAxis::Top, WallAxis::Bottom);
  consider(a.z, v.z, p.z, b.minZ, b.maxZ, WallAxis::NearZ, WallAxis::FarZ);

  if (!std::isfinite(best_t) || best_t >= std::numeric_limits<double>::infinity()) {
    return std::nullopt;
  }
  return std::make_pair(best_t, best_wall);
}

std::optional<std::pair<double, WallAxis>> earliest_wrap_crossing_time_2d_uniform_accel(
    Vec2 p,
    Vec2 v,
    Vec2 a,
    const VolumeBounds& b,
    double t_ref,
    double t_min) {
  if (len_sq(a) < kEps * kEps) {
    return earliest_wrap_crossing_time(p, v, b, t_ref, t_min);
  }
  double best_t = std::numeric_limits<double>::infinity();
  WallAxis best_wall = WallAxis::Left;

  auto consider = [&](double acc, double vp, double pos, double target, WallAxis w) {
    const double c = pos - target;
    const auto dt = earliest_uniform_accel_axis_hit_dt(acc, vp, c, t_ref, t_min);
    if (!dt.has_value()) {
      return;
    }
    const double T = t_ref + *dt;
    if (T > t_min - kTimeEps && *dt >= kMinPairDt && T < best_t) {
      best_t = T;
      best_wall = w;
    }
  };

  consider(a.x, v.x, p.x, b.minX, WallAxis::Left);
  consider(a.x, v.x, p.x, b.maxX, WallAxis::Right);
  consider(a.y, v.y, p.y, b.minY, WallAxis::Top);
  consider(a.y, v.y, p.y, b.maxY, WallAxis::Bottom);

  if (!std::isfinite(best_t) || best_t >= std::numeric_limits<double>::infinity()) {
    return std::nullopt;
  }
  return std::make_pair(best_t, best_wall);
}

std::optional<double> earliest_pair_collision_time(Vec2 p1,
                                                   Vec2 v1,
                                                   double r1,
                                                   Vec2 p2,
                                                   Vec2 v2,
                                                   double r2,
                                                   double t_ref,
                                                   double t_min) {
  const Vec2 P{p2.x - p1.x, p2.y - p1.y};
  const Vec2 V{v2.x - v1.x, v2.y - v1.y};
  if (dot(V, P) >= -kEps) {
    return std::nullopt;
  }
  const double v_rel_sq = len_sq(V);
  const double v_min_sq = kMinRelativeSpeed * kMinRelativeSpeed;
  if (v_rel_sq < v_min_sq) {
    return std::nullopt;
  }
  const double R = r1 + r2;
  const double R2 = R * R;

  const double P_len_sq = len_sq(P);
  if (P_len_sq < (R - kEps) * (R - kEps)) {
    return t_ref + kMinPairDt;
  }

  const double a = len_sq(V);
  const double b = 2 * dot(P, V);
  const double c = len_sq(P) - R2;

  std::optional<double> dt;

  if (a < kEps) {
    if (std::abs(b) < kEps) {
      if (std::abs(c) < kEps * R2) {
        return std::nullopt;
      }
      return std::nullopt;
    }
    const double root = -c / b;
#if defined(ORACLE_ZENO_DEBUG) && ORACLE_ZENO_DEBUG
    std::cout << "[QUAD linear] b=" << b << " c=" << c << " root=" << root << std::endl;
#endif
    if (root > t_min - t_ref - kTimeEps && root < std::numeric_limits<double>::infinity()) {
      dt = root;
    }
  } else {
    const double disc = b * b - 4 * a * c;
    if (disc < -kEps) {
      return std::nullopt;
    }
    const double sqrt_d = disc <= 0 ? 0 : std::sqrt(disc);
    const double t1 = (-b - sqrt_d) / (2 * a);
    const double t2 = (-b + sqrt_d) / (2 * a);
#if defined(ORACLE_ZENO_DEBUG) && ORACLE_ZENO_DEBUG
    std::cout << "[QUAD] disc=" << disc << " t1=" << t1 << " t2=" << t2 << " a=" << a << " b=" << b << " c=" << c
              << " t_min-t_ref=" << (t_min - t_ref) << std::endl;
#endif
    double best = std::numeric_limits<double>::infinity();
    if (t1 > t_min - t_ref - kTimeEps && std::isfinite(t1)) {
      best = std::min(best, t1);
    }
    if (t2 > t_min - t_ref - kTimeEps && std::isfinite(t2)) {
      best = std::min(best, t2);
    }
    if (best < std::numeric_limits<double>::infinity()) {
      dt = best;
#if defined(ORACLE_ZENO_DEBUG) && ORACLE_ZENO_DEBUG
      std::cout << "[QUAD] chosen_dt=" << *dt << " (from quadratic branch)" << std::endl;
#endif
    }
  }

  if (!dt.has_value() || *dt < kMinPairDt) {
    return std::nullopt;
  }
  const double T = t_ref + *dt;
#if defined(ORACLE_ZENO_DEBUG) && ORACLE_ZENO_DEBUG
  std::cout << "[QUAD] final dt=" << *dt << " T=" << T << " t_ref=" << t_ref << std::endl;
#endif
  if (T < t_min - kTimeEps) {
    return std::nullopt;
  }
  return T;
}

std::optional<double> earliest_pair_collision_time_3d(Vec3 p1,
                                                      Vec3 v1,
                                                      double r1,
                                                      Vec3 p2,
                                                      Vec3 v2,
                                                      double r2,
                                                      double t_ref,
                                                      double t_min) {
  const Vec3 P{p2.x - p1.x, p2.y - p1.y, p2.z - p1.z};
  const Vec3 V{v2.x - v1.x, v2.y - v1.y, v2.z - v1.z};
  if (dot3(V, P) >= -kEps) {
    return std::nullopt;
  }
  const double v_rel_sq = len_sq3(V);
  const double v_min_sq = kMinRelativeSpeed * kMinRelativeSpeed;
  if (v_rel_sq < v_min_sq) {
    return std::nullopt;
  }
  const double R = r1 + r2;
  const double R2 = R * R;

  const double P_len_sq = len_sq3(P);
  if (P_len_sq < (R - kEps) * (R - kEps)) {
    return t_ref + kMinPairDt;
  }

  const double a = len_sq3(V);
  const double b = 2 * dot3(P, V);
  const double c = len_sq3(P) - R2;

  std::optional<double> dt;

  if (a < kEps) {
    if (std::abs(b) < kEps) {
      return std::nullopt;
    }
    const double root = -c / b;
    if (root > t_min - t_ref - kTimeEps && root < std::numeric_limits<double>::infinity()) {
      dt = root;
    }
  } else {
    const double disc = b * b - 4 * a * c;
    if (disc < -kEps) {
      return std::nullopt;
    }
    const double sqrt_d = disc <= 0 ? 0 : std::sqrt(disc);
    const double t1 = (-b - sqrt_d) / (2 * a);
    const double t2 = (-b + sqrt_d) / (2 * a);
    double best = std::numeric_limits<double>::infinity();
    if (t1 > t_min - t_ref - kTimeEps && std::isfinite(t1)) {
      best = std::min(best, t1);
    }
    if (t2 > t_min - t_ref - kTimeEps && std::isfinite(t2)) {
      best = std::min(best, t2);
    }
    if (best < std::numeric_limits<double>::infinity()) {
      dt = best;
    }
  }

  if (!dt.has_value() || *dt < kMinPairDt) {
    return std::nullopt;
  }
  const double T = t_ref + *dt;
  if (T < t_min - kTimeEps) {
    return std::nullopt;
  }
  return T;
}

Vec2 normalize(Vec2 v) {
  const double L = std::sqrt(len_sq(v));
  if (L < kEps) {
    return {1, 0};
  }
  return {v.x / L, v.y / L};
}

void resolve_elastic_pair(Particle& a, Particle& b, double restitution) {
  const double dx = b.pos_x - a.pos_x;
  const double dy = b.pos_y - a.pos_y;
  const double dist = std::hypot(dx, dy);
  if (dist < kEps) {
    return;
  }
  const double nx = dx / dist;
  const double ny = dy / dist;

  const double dvx = b.vel_x - a.vel_x;
  const double dvy = b.vel_y - a.vel_y;
  const double vn = dvx * nx + dvy * ny;
  if (vn >= -kEps) {
    return;
  }

  const double mass_sum = a.mass + b.mass;
  if (mass_sum < kEps) {
    return;
  }
  const double reduced = (a.mass * b.mass) / mass_sum;
  const double j = -(1.0 + restitution) * reduced * vn;

  a.vel_x -= (j * nx) / a.mass;
  a.vel_y -= (j * ny) / a.mass;
  b.vel_x += (j * nx) / a.mass;
  b.vel_y += (j * ny) / b.mass;
}

void resolve_elastic_pair_3d(Particle& a, Particle& b, double restitution) {
  const double dx = b.pos_x - a.pos_x;
  const double dy = b.pos_y - a.pos_y;
  const double dz = b.pos_z - a.pos_z;
  const double dist = std::sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < kEps) {
    return;
  }
  const double nx = dx / dist;
  const double ny = dy / dist;
  const double nz = dz / dist;

  const double dvx = b.vel_x - a.vel_x;
  const double dvy = b.vel_y - a.vel_y;
  const double dvz = b.vel_z - a.vel_z;
  const double vn = dvx * nx + dvy * ny + dvz * nz;
  if (vn >= -kEps) {
    return;
  }

  const double mass_sum = a.mass + b.mass;
  if (mass_sum < kEps) {
    return;
  }
  const double reduced = (a.mass * b.mass) / mass_sum;
  const double j = -(1.0 + restitution) * reduced * vn;

  a.vel_x -= (j * nx) / a.mass;
  a.vel_y -= (j * ny) / a.mass;
  a.vel_z -= (j * nz) / a.mass;
  b.vel_x += (j * nx) / b.mass;
  b.vel_y += (j * ny) / b.mass;
  b.vel_z += (j * nz) / b.mass;
}

}  // namespace oracle
