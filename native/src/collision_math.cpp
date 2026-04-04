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

}  // namespace

std::optional<std::pair<double, WallAxis>> earliest_wall_collision_time(
    Vec2 p,
    Vec2 v,
    double r,
    const AxisBounds& b,
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
  // Not approaching: relative velocity does not reduce separation (Zeno / overlap churn).
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
  const double dvx = b.vel_x - a.vel_x;
  const double dvy = b.vel_y - a.vel_y;
  const double dv_dr = dvx * dx + dvy * dy;
  // Same approaching convention as earliest_pair_collision_time: dot(V,P) < 0 with P = p2-p1, V = v2-v1.
  if (dv_dr >= -kEps) {
    return;
  }
  const double dist = std::hypot(dx, dy);
  const double radius_sum = a.radius + b.radius;
  double nx = 1.0;
  double ny = 0.0;
  if (dist >= kEps) {
    nx = dx / dist;
    ny = dy / dist;
  }
  const double inv_m_sum = a.mass + b.mass;
  if (inv_m_sum < kEps || radius_sum < kEps) {
    return;
  }
  const double J = (1.0 + restitution) * a.mass * b.mass * dv_dr / (radius_sum * inv_m_sum);
  const double Jx = (J * dx) / radius_sum;
  const double Jy = (J * dy) / radius_sum;
  a.vel_x += Jx / a.mass;
  a.vel_y += Jy / a.mass;
  b.vel_x -= Jx / b.mass;
  b.vel_y -= Jy / b.mass;
  const double h = 0.5 * kPostCollisionSeparation;
  a.pos_x -= nx * h;
  a.pos_y -= ny * h;
  b.pos_x += nx * h;
  b.pos_y += ny * h;
}

}  // namespace oracle
