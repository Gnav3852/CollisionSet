#include "oracle/collision_math.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

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
    if (T > t_min - kTimeEps && T < best_t) {
      best_t = T;
      best_wall = WallAxis::Left;
    }
  }
  if (v.x > kEps) {
    const double T = t_ref + (b.maxX - r - p.x) / v.x;
    if (T > t_min - kTimeEps && T < best_t) {
      best_t = T;
      best_wall = WallAxis::Right;
    }
  }
  if (v.y < -kEps) {
    const double T = t_ref + (b.minY + r - p.y) / v.y;
    if (T > t_min - kTimeEps && T < best_t) {
      best_t = T;
      best_wall = WallAxis::Top;
    }
  }
  if (v.y > kEps) {
    const double T = t_ref + (b.maxY - r - p.y) / v.y;
    if (T > t_min - kTimeEps && T < best_t) {
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

  if (!dt.has_value() || *dt < kTimeEps) {
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

void resolve_elastic_pair(Particle& a, Particle& b, Vec2 n, double restitution) {
  const double rvx = a.vel_x - b.vel_x;
  const double rvy = a.vel_y - b.vel_y;
  const double vel_along_n = rvx * n.x + rvy * n.y;
  if (vel_along_n >= -kEps) {
    return;
  }
  const double inv_mass_sum = 1.0 / a.mass + 1.0 / b.mass;
  const double j = -(1.0 + restitution) * vel_along_n / inv_mass_sum;
  const double jx = j * n.x;
  const double jy = j * n.y;
  a.vel_x += jx / a.mass;
  a.vel_y += jy / a.mass;
  b.vel_x -= jx / b.mass;
  b.vel_y -= jy / b.mass;
}

}  // namespace oracle
