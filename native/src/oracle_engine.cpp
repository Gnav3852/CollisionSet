#include "oracle/oracle_engine.hpp"

#include "oracle/collision_math.hpp"

#include <algorithm>
#include <cmath>
#if defined(ORACLE_ZENO_DEBUG) && ORACLE_ZENO_DEBUG
#include <iostream>
#endif

namespace oracle {

namespace {

Vec3 normalize3(double dx, double dy, double dz) {
  const double L = std::sqrt(dx * dx + dy * dy + dz * dz);
  if (L < kEps) {
    return {1, 0, 0};
  }
  return {dx / L, dy / L, dz / L};
}

}  // namespace

OracleEngine::OracleEngine(int max_particles, VolumeBounds bounds)
    : capacity_(max_particles),
      bounds_(bounds),
      heap_(EventTimeKey{}) {
  particles_.resize(static_cast<std::size_t>(std::max(0, max_particles)));
  divider_x_ = 0.5 * (bounds.minX + bounds.maxX);
  const double mid_y = 0.5 * (bounds.minY + bounds.maxY);
  const double half_gap = 0.08 * (bounds.maxY - bounds.minY);
  gap_top_ = mid_y - half_gap;
  gap_bot_ = mid_y + half_gap;
}

void OracleEngine::set_space_mode(SpaceMode m) {
  if (space_mode_ == m) {
    return;
  }
  space_mode_ = m;
  if (m == SpaceMode::XYZ) {
    torus_mode_ = false;
    divider_active_ = false;
    door_open_ = false;
  }
  const double zm = z_mid();
  for (int i = 0; i < n_active_; ++i) {
    Particle& p = particles_[static_cast<std::size_t>(i)];
    if (m == SpaceMode::XY) {
      p.pos_z = zm;
      p.vel_z = 0;
    }
    p.collision_count++;
  }
  heap_.clear();
  predict_all();
}

void OracleEngine::set_particle_count(int n) {
  if (n < 0 || n > capacity_) {
    return;
  }
  n_active_ = n;
}

void OracleEngine::set_restitution(double e) {
  if (e < 0.0) {
    e = 0.0;
  } else if (e > 1.0) {
    e = 1.0;
  }
  restitution_ = e;
}

void OracleEngine::set_gravity(double ax, double ay, double az) {
  if (gravity_.x == ax && gravity_.y == ay && gravity_.z == az) {
    return;
  }
  gravity_.x = ax;
  gravity_.y = ay;
  gravity_.z = az;
  invalidate_and_repredict_all();
}

void OracleEngine::set_torus_mode(bool on) {
  if (space_mode_ == SpaceMode::XYZ) {
    return;
  }
  if (torus_mode_ == on) {
    return;
  }
  torus_mode_ = on;
  const double W = bounds_.maxX - bounds_.minX;
  const double H = bounds_.maxY - bounds_.minY;
  for (int i = 0; i < n_active_; ++i) {
    Particle& p = particles_[static_cast<std::size_t>(i)];
    if (on && W > kEps && H > kEps) {
      while (p.pos_x < bounds_.minX) p.pos_x += W;
      while (p.pos_x >= bounds_.maxX) p.pos_x -= W;
      while (p.pos_y < bounds_.minY) p.pos_y += H;
      while (p.pos_y >= bounds_.maxY) p.pos_y -= H;
    }
    p.collision_count++;
  }
  heap_.clear();
  predict_all();
}

void OracleEngine::invalidate_and_repredict_all() {
  for (int i = 0; i < n_active_; ++i) {
    particles_[static_cast<std::size_t>(i)].collision_count++;
  }
  heap_.clear();
  predict_all();
}

void OracleEngine::set_divider_active(bool on) {
  if (space_mode_ == SpaceMode::XYZ) {
    return;
  }
  if (divider_active_ == on) {
    return;
  }
  divider_active_ = on;
  invalidate_and_repredict_all();
}

void OracleEngine::set_door_open(bool open) {
  if (space_mode_ == SpaceMode::XYZ) {
    return;
  }
  if (door_open_ == open) {
    return;
  }
  door_open_ = open;
  if (divider_active_) {
    invalidate_and_repredict_all();
  }
}

void OracleEngine::set_divider_geometry(double xs, double gap_top_y, double gap_bot_y) {
  if (space_mode_ == SpaceMode::XYZ) {
    return;
  }
  divider_x_ = xs;
  if (gap_top_y > gap_bot_y) {
    std::swap(gap_top_y, gap_bot_y);
  }
  gap_top_ = gap_top_y;
  gap_bot_ = gap_bot_y;
  if (divider_active_) {
    invalidate_and_repredict_all();
  }
}

void OracleEngine::set_particle(int i,
                                double px,
                                double py,
                                double pz,
                                double vx,
                                double vy,
                                double vz,
                                double r,
                                double m) {
  if (i < 0 || i >= capacity_) {
    return;
  }
  Particle& p = particles_[static_cast<std::size_t>(i)];
  p.pos_x = px;
  p.pos_y = py;
  p.pos_z = pz;
  p.vel_x = vx;
  p.vel_y = vy;
  p.vel_z = vz;
  p.radius = r;
  p.mass = m;
  p.last_update_time = 0;
  p.collision_count = 0;
  p.pad = 0;
  if (space_mode_ == SpaceMode::XY) {
    p.pos_z = z_mid();
    p.vel_z = 0;
  }
}

void OracleEngine::bootstrap() {
  integrate_all(0);
  sim_time_ = 0;
  heap_.clear();
  zeno_micro_streak_ = 0;
  predict_all();
}

Vec3 OracleEngine::pos_at(int i, double t) const {
  const Particle& p = particles_[static_cast<std::size_t>(i)];
  const double dt = t - p.last_update_time;
  const double gx = gravity_.x;
  const double gy = gravity_.y;
  const double gz = space_mode_ == SpaceMode::XYZ ? gravity_.z : 0.0;
  const double half = 0.5 * dt * dt;
  return {p.pos_x + p.vel_x * dt + gx * half,
          p.pos_y + p.vel_y * dt + gy * half,
          p.pos_z + p.vel_z * dt + gz * half};
}

void OracleEngine::integrate_all(double t) {
  for (int i = 0; i < n_active_; ++i) {
    Particle& p = particles_[static_cast<std::size_t>(i)];
    const double t0 = p.last_update_time;
    const double dt = t - t0;
    const double gx = gravity_.x;
    const double gy = gravity_.y;
    const double gz = space_mode_ == SpaceMode::XYZ ? gravity_.z : 0.0;
    const double half = 0.5 * dt * dt;
    p.pos_x += p.vel_x * dt + gx * half;
    p.pos_y += p.vel_y * dt + gy * half;
    p.vel_x += gx * dt;
    p.vel_y += gy * dt;
    if (space_mode_ == SpaceMode::XYZ) {
      p.pos_z += p.vel_z * dt + gz * half;
      p.vel_z += gz * dt;
    } else {
      p.pos_z = z_mid();
      p.vel_z = 0;
    }
    p.last_update_time = t;
  }
}

bool OracleEngine::validate_event(const SimEvent& e) const {
  if (e.kind == EventKind::Wall) {
    const Particle& p = particles_[static_cast<std::size_t>(e.a)];
    return e.count_a == p.collision_count;
  }
  const Particle& pa = particles_[static_cast<std::size_t>(e.a)];
  const Particle& pb = particles_[static_cast<std::size_t>(e.b)];
  return e.count_a == pa.collision_count && e.count_b == pb.collision_count;
}

void OracleEngine::predict_pair(int i, int j) {
  if (i == j || i < 0 || j < 0 || i >= n_active_ || j >= n_active_) {
    return;
  }
  const double t0 = sim_time_;
  const Particle& a = particles_[static_cast<std::size_t>(i)];
  const Particle& b = particles_[static_cast<std::size_t>(j)];

  if (space_mode_ == SpaceMode::XYZ) {
    const Vec3 pa = pos_at(i, t0);
    const Vec3 pb = pos_at(j, t0);
    const auto T =
        earliest_pair_collision_time_3d(pa, {a.vel_x, a.vel_y, a.vel_z}, a.radius, pb,
                                         {b.vel_x, b.vel_y, b.vel_z}, b.radius, t0, t0 + kTimeEps);
    if (!T.has_value() || !std::isfinite(*T)) {
      return;
    }
    SimEvent ev{};
    ev.time = *T;
    ev.kind = EventKind::Pair;
    ev.a = i;
    ev.b = j;
    ev.count_a = a.collision_count;
    ev.count_b = b.collision_count;
    heap_.push(std::move(ev));
    return;
  }

  const Vec3 pa3 = pos_at(i, t0);
  Vec3 pb3 = pos_at(j, t0);
  Vec2 pa{pa3.x, pa3.y};
  Vec2 pb{pb3.x, pb3.y};
  if (torus_mode_) {
    const double W = bounds_.maxX - bounds_.minX;
    const double H = bounds_.maxY - bounds_.minY;
    const double dx = pb.x - pa.x;
    const double dy = pb.y - pa.y;
    if (dx > W * 0.5) pb.x -= W;
    else if (dx < -W * 0.5) pb.x += W;
    if (dy > H * 0.5) pb.y -= H;
    else if (dy < -H * 0.5) pb.y += H;
  }
#if defined(ORACLE_ZENO_DEBUG) && ORACLE_ZENO_DEBUG
  if (zeno_micro_streak_ > 10) {
    const double dx = pb.x - pa.x;
    const double dy = pb.y - pa.y;
    const double dist = std::hypot(dx, dy);
    const double R = a.radius + b.radius;
    const double overlap = R - dist;
    const double vx = b.vel_x - a.vel_x;
    const double vy = b.vel_y - a.vel_y;
    const double dvp = vx * dx + vy * dy;
    std::cout << "[HOT_PAIR] t0=" << t0 << " i=" << i << " j=" << j << " dist=" << dist
              << " R=" << R << " overlap=" << overlap << " dot(V,P)=" << dvp << std::endl;
  }
#endif
  const auto T = earliest_pair_collision_time(pa, {a.vel_x, a.vel_y}, a.radius, pb,
                                                {b.vel_x, b.vel_y}, b.radius, t0, t0 + kTimeEps);
  if (!T.has_value() || !std::isfinite(*T)) {
    return;
  }
  SimEvent ev{};
  ev.time = *T;
  ev.kind = EventKind::Pair;
  ev.a = i;
  ev.b = j;
  ev.count_a = a.collision_count;
  ev.count_b = b.collision_count;
  heap_.push(std::move(ev));
}

void OracleEngine::predict_wall(int i) {
  if (i < 0 || i >= n_active_) {
    return;
  }
  const double t0 = sim_time_;
  const Particle& p = particles_[static_cast<std::size_t>(i)];

  if (space_mode_ == SpaceMode::XYZ) {
    const Vec3 pos = pos_at(i, t0);
    const Vec3 gv{gravity_.x, gravity_.y, gravity_.z};
    const double g2 = gv.x * gv.x + gv.y * gv.y + gv.z * gv.z;
    const std::optional<std::pair<double, WallAxis>> hit =
        (g2 < kEps * kEps)
            ? earliest_wall_collision_time_3d(
                  pos, {p.vel_x, p.vel_y, p.vel_z}, p.radius, bounds_, t0, t0 + kTimeEps)
            : earliest_wall_collision_time_3d_uniform_accel(
                  pos, {p.vel_x, p.vel_y, p.vel_z}, gv, p.radius, bounds_, t0, t0 + kTimeEps);
    if (!hit.has_value()) {
      return;
    }
    SimEvent ev{};
    ev.time = hit->first;
    ev.kind = EventKind::Wall;
    ev.a = i;
    ev.b = 0;
    ev.wall = hit->second;
    ev.count_a = p.collision_count;
    ev.count_b = 0;
    heap_.push(std::move(ev));
    return;
  }

  const Vec3 pos3 = pos_at(i, t0);
  const Vec2 pos{pos3.x, pos3.y};
  const Vec2 ga{gravity_.x, gravity_.y};
  const double g2 = ga.x * ga.x + ga.y * ga.y;
  std::optional<std::pair<double, WallAxis>> hit;
  if (torus_mode_) {
    hit = (g2 < kEps * kEps)
              ? earliest_wrap_crossing_time({pos.x, pos.y}, {p.vel_x, p.vel_y}, bounds_, t0,
                                             t0 + kTimeEps)
              : earliest_wrap_crossing_time_2d_uniform_accel(
                    {pos.x, pos.y}, {p.vel_x, p.vel_y}, ga, bounds_, t0, t0 + kTimeEps);
  } else {
    hit = (g2 < kEps * kEps)
              ? earliest_wall_collision_time({pos.x, pos.y}, {p.vel_x, p.vel_y}, p.radius, bounds_,
                                               t0, t0 + kTimeEps)
              : earliest_wall_collision_time_2d_uniform_accel(
                    {pos.x, pos.y}, {p.vel_x, p.vel_y}, ga, p.radius, bounds_, t0, t0 + kTimeEps);
  }
  if (!hit.has_value()) {
    return;
  }
  SimEvent ev{};
  ev.time = hit->first;
  ev.kind = EventKind::Wall;
  ev.a = i;
  ev.b = 0;
  ev.wall = hit->second;
  ev.count_a = p.collision_count;
  ev.count_b = 0;
  heap_.push(std::move(ev));
}

void OracleEngine::predict_divider(int i) {
  if (space_mode_ == SpaceMode::XYZ || !divider_active_) {
    return;
  }
  if (i < 0 || i >= n_active_) {
    return;
  }
  const double t0 = sim_time_;
  const Particle& p = particles_[static_cast<std::size_t>(i)];
  const Vec3 pos3 = pos_at(i, t0);
  const Vec2 pos{pos3.x, pos3.y};
  const double gx = gravity_.x;
  const double gy = gravity_.y;

  std::optional<double> best_t;
  auto try_plane = [&](double target_x) {
    const double c = pos.x - target_x;
    const auto dt_opt = earliest_uniform_accel_axis_hit_dt(gx, p.vel_x, c, t0, t0 + kTimeEps);
    if (!dt_opt.has_value()) {
      return;
    }
    const double T = t0 + *dt_opt;
    if (T <= t0 + kTimeEps) {
      return;
    }
    const double dty = T - t0;
    const double y_at = pos.y + p.vel_y * dty + 0.5 * gy * dty * dty;
    if (door_open_ && y_at >= gap_top_ && y_at <= gap_bot_) {
      return;
    }
    if (!best_t.has_value() || T < *best_t) {
      best_t = T;
    }
  };

  if (pos.x + p.radius < divider_x_ - kEps) {
    try_plane(divider_x_ - p.radius);
  }
  if (pos.x - p.radius > divider_x_ + kEps) {
    try_plane(divider_x_ + p.radius);
  }

  if (!best_t.has_value()) {
    return;
  }

  SimEvent ev{};
  ev.time = *best_t;
  ev.kind = EventKind::Wall;
  ev.a = i;
  ev.b = 0;
  ev.wall = WallAxis::Divider;
  ev.count_a = p.collision_count;
  ev.count_b = 0;
  heap_.push(std::move(ev));
}

void OracleEngine::predict_all() {
  for (int i = 0; i < n_active_; ++i) {
    predict_wall(i);
    predict_divider(i);
    for (int j = i + 1; j < n_active_; ++j) {
      predict_pair(i, j);
    }
  }
}

void OracleEngine::repredict_involved(const std::vector<int>& indices) {
  std::vector<char> in_set(static_cast<std::size_t>(n_active_), 0);
  for (int idx : indices) {
    if (idx >= 0 && idx < n_active_) {
      in_set[static_cast<std::size_t>(idx)] = 1;
    }
  }
  for (int i = 0; i < n_active_; ++i) {
    if (!in_set[static_cast<std::size_t>(i)]) {
      continue;
    }
    predict_wall(i);
    predict_divider(i);
    for (int j = 0; j < n_active_; ++j) {
      if (i == j) {
        continue;
      }
      predict_pair(i, j);
    }
  }
}

void OracleEngine::resolve_wall(const SimEvent& e) {
  Particle& p = particles_[static_cast<std::size_t>(e.a)];
  if (torus_mode_ && space_mode_ == SpaceMode::XY && e.wall != WallAxis::Divider) {
    const double W = bounds_.maxX - bounds_.minX;
    const double H = bounds_.maxY - bounds_.minY;
    switch (e.wall) {
      case WallAxis::Left:
        p.pos_x += W;
        break;
      case WallAxis::Right:
        p.pos_x -= W;
        break;
      case WallAxis::Top:
        p.pos_y += H;
        break;
      case WallAxis::Bottom:
        p.pos_y -= H;
        break;
      case WallAxis::Divider:
      case WallAxis::NearZ:
      case WallAxis::FarZ:
        break;
    }
    p.collision_count++;
    return;
  }
  switch (e.wall) {
    case WallAxis::Left:
    case WallAxis::Right:
      p.vel_x = -p.vel_x;
      break;
    case WallAxis::Top:
    case WallAxis::Bottom:
      p.vel_y = -p.vel_y;
      break;
    case WallAxis::Divider:
      p.vel_x = -p.vel_x;
      break;
    case WallAxis::NearZ:
    case WallAxis::FarZ:
      p.vel_z = -p.vel_z;
      break;
  }
  const double eps = kPostCollisionSeparation;
  switch (e.wall) {
    case WallAxis::Left:
      p.pos_x += eps;
      break;
    case WallAxis::Right:
      p.pos_x -= eps;
      break;
    case WallAxis::Top:
      p.pos_y += eps;
      break;
    case WallAxis::Bottom:
      p.pos_y -= eps;
      break;
    case WallAxis::Divider:
      if (p.vel_x > 0) {
        p.pos_x += eps;
      } else {
        p.pos_x -= eps;
      }
      break;
    case WallAxis::NearZ:
      if (p.vel_z > 0) {
        p.pos_z += eps;
      } else {
        p.pos_z -= eps;
      }
      break;
    case WallAxis::FarZ:
      if (p.vel_z < 0) {
        p.pos_z -= eps;
      } else {
        p.pos_z += eps;
      }
      break;
  }
  p.collision_count++;
}

void OracleEngine::resolve_pair(const SimEvent& e) {
  Particle& a = particles_[static_cast<std::size_t>(e.a)];
  Particle& b = particles_[static_cast<std::size_t>(e.b)];

  if (space_mode_ == SpaceMode::XYZ) {
    resolve_elastic_pair_3d(a, b, restitution_);
    const double ra = a.radius;
    const double rb = b.radius;
    const double R = ra + rb;
    const double target = R + kPostCollisionSeparation;
    double dx = b.pos_x - a.pos_x;
    double dy = b.pos_y - a.pos_y;
    double dz = b.pos_z - a.pos_z;
    double dist = std::sqrt(dx * dx + dy * dy + dz * dz);
    double nx = 1, ny = 0, nz = 0;
    if (dist >= kEps) {
      nx = dx / dist;
      ny = dy / dist;
      nz = dz / dist;
    }
    if (dist <= target) {
      const double lack = target - dist;
      const double half = 0.5 * lack;
      a.pos_x -= nx * half;
      a.pos_y -= ny * half;
      a.pos_z -= nz * half;
      b.pos_x += nx * half;
      b.pos_y += ny * half;
      b.pos_z += nz * half;
    }
    a.collision_count++;
    b.collision_count++;
    return;
  }

  double wrap_dx = 0.0;
  double wrap_dy = 0.0;
  if (torus_mode_) {
    const double W = bounds_.maxX - bounds_.minX;
    const double H = bounds_.maxY - bounds_.minY;
    double dxi = b.pos_x - a.pos_x;
    double dyi = b.pos_y - a.pos_y;
    if (dxi > W * 0.5) wrap_dx = -W;
    else if (dxi < -W * 0.5) wrap_dx = W;
    if (dyi > H * 0.5) wrap_dy = -H;
    else if (dyi < -H * 0.5) wrap_dy = H;
    b.pos_x += wrap_dx;
    b.pos_y += wrap_dy;
  }
  resolve_elastic_pair(a, b, restitution_);
  const double ra = a.radius;
  const double rb = b.radius;
  const double R = ra + rb;
  const double target = R + kPostCollisionSeparation;
  double dx = b.pos_x - a.pos_x;
  double dy = b.pos_y - a.pos_y;
  double dist = std::hypot(dx, dy);
  Vec2 sep_n{1.0, 0.0};
  if (dist >= kEps) {
    sep_n = {dx / dist, dy / dist};
  }
  if (dist <= target) {
    const double lack = target - dist;
    const double half = 0.5 * lack;
    a.pos_x -= sep_n.x * half;
    a.pos_y -= sep_n.y * half;
    b.pos_x += sep_n.x * half;
    b.pos_y += sep_n.y * half;
  }
  dx = b.pos_x - a.pos_x;
  dy = b.pos_y - a.pos_y;
  dist = std::hypot(dx, dy);
#if defined(ORACLE_ZENO_DEBUG) && ORACLE_ZENO_DEBUG
  std::cout << "[RESOLVE] Post-nudge distance: " << dist << " | Combined radii: " << R << std::endl;
  if (dist <= R + kEps) {
    std::cout << "[RESOLVE] **WARNING** centers still at or inside contact (dist <= R + kEps)" << std::endl;
  }
#endif
  if (torus_mode_ && (wrap_dx != 0.0 || wrap_dy != 0.0)) {
    b.pos_x -= wrap_dx;
    b.pos_y -= wrap_dy;
    const double W = bounds_.maxX - bounds_.minX;
    const double H = bounds_.maxY - bounds_.minY;
    auto wrap = [&](double& x, double lo, double hi, double L) {
      if (x < lo) x += L;
      else if (x >= hi) x -= L;
    };
    wrap(a.pos_x, bounds_.minX, bounds_.maxX, W);
    wrap(a.pos_y, bounds_.minY, bounds_.maxY, H);
    wrap(b.pos_x, bounds_.minX, bounds_.maxX, W);
    wrap(b.pos_y, bounds_.minY, bounds_.maxY, H);
  }
  a.collision_count++;
  b.collision_count++;
}

bool OracleEngine::process_next_collision() {
  while (!heap_.empty()) {
    SimEvent e = heap_.pop();
    if (!validate_event(e)) {
      continue;
    }
#if defined(ORACLE_ZENO_DEBUG) && ORACLE_ZENO_DEBUG
    {
      const double dt_step = e.time - sim_time_;
      if (dt_step >= 0.0 && dt_step < 1e-6) {
        ++zeno_micro_streak_;
      } else {
        zeno_micro_streak_ = 0;
      }
      if (zeno_micro_streak_ > 50) {
        std::cout << "[BREAKER] sim_time: " << sim_time_ << " event_time: " << e.time
                  << " dt_step: " << dt_step << " streak: " << zeno_micro_streak_ << std::endl;
        heap_.clear();
        zeno_micro_streak_ = 0;
        return false;
      }
    }
#endif
    integrate_all(e.time);
    sim_time_ = e.time;
    if (e.kind == EventKind::Wall) {
      resolve_wall(e);
      repredict_involved({e.a});
    } else {
      resolve_pair(e);
      repredict_involved({e.a, e.b});
    }
    return true;
  }
  return false;
}

int OracleEngine::step_collisions(int max_steps) {
  int done = 0;
  while (done < max_steps && process_next_collision()) {
    ++done;
  }
  return done;
}

std::optional<SimEvent> OracleEngine::peek_next() const {
  if (heap_.empty()) {
    return std::nullopt;
  }
  const std::vector<SimEvent> sorted = heap_.snapshot_sorted();
  for (const SimEvent& e : sorted) {
    if (validate_event(e)) {
      return e;
    }
  }
  return std::nullopt;
}

std::optional<double> OracleEngine::peek_next_time() const {
  const auto e = peek_next();
  if (!e.has_value()) {
    return std::nullopt;
  }
  return e->time;
}

void OracleEngine::purge_events_before(double t_cut) {
  const std::vector<SimEvent> sorted = heap_.snapshot_sorted();
  heap_.clear();
  for (SimEvent e : sorted) {
    if (!(e.time < t_cut - kTimeEps)) {
      heap_.push(std::move(e));
    }
  }
}

std::optional<Vec3> OracleEngine::peek_next_impact() const {
  const auto ev = peek_next();
  if (!ev.has_value()) {
    return std::nullopt;
  }
  const SimEvent& e = *ev;
  if (e.kind == EventKind::Wall) {
    const int i = e.a;
    if (i < 0 || i >= n_active_) {
      return std::nullopt;
    }
    const Vec3 p = pos_at(i, e.time);
    switch (e.wall) {
      case WallAxis::Left:
        return Vec3{bounds_.minX, p.y, p.z};
      case WallAxis::Right:
        return Vec3{bounds_.maxX, p.y, p.z};
      case WallAxis::Top:
        return Vec3{p.x, bounds_.minY, p.z};
      case WallAxis::Bottom:
        return Vec3{p.x, bounds_.maxY, p.z};
      case WallAxis::Divider:
        return Vec3{divider_x_, p.y, p.z};
      case WallAxis::NearZ:
        return Vec3{p.x, p.y, bounds_.minZ};
      case WallAxis::FarZ:
        return Vec3{p.x, p.y, bounds_.maxZ};
    }
  }
  const int ia = e.a;
  const int ib = e.b;
  if (ia < 0 || ib < 0 || ia >= n_active_ || ib >= n_active_) {
    return std::nullopt;
  }
  const Vec3 pa = pos_at(ia, e.time);
  const Vec3 pb = pos_at(ib, e.time);
  if (space_mode_ == SpaceMode::XYZ) {
    const Vec3 n = normalize3(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
    const double ra = particles_[static_cast<std::size_t>(ia)].radius;
    return Vec3{pa.x + n.x * ra, pa.y + n.y * ra, pa.z + n.z * ra};
  }
  const Vec2 n2 = normalize({pb.x - pa.x, pb.y - pa.y});
  const double ra = particles_[static_cast<std::size_t>(ia)].radius;
  return Vec3{pa.x + n2.x * ra, pa.y + n2.y * ra, pa.z};
}

}  // namespace oracle
