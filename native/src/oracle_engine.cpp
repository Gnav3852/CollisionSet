#include "oracle/oracle_engine.hpp"

#include "oracle/collision_math.hpp"

#include <algorithm>
#include <cmath>
#if defined(ORACLE_ZENO_DEBUG) && ORACLE_ZENO_DEBUG
#include <iostream>
#endif

namespace oracle {

OracleEngine::OracleEngine(int max_particles, AxisBounds bounds)
    : capacity_(max_particles),
      bounds_(bounds),
      heap_(EventTimeKey{}) {
  particles_.resize(static_cast<std::size_t>(std::max(0, max_particles)));
}

void OracleEngine::set_particle_count(int n) {
  if (n < 0 || n > capacity_) {
    return;
  }
  n_active_ = n;
}

void OracleEngine::set_particle(int i,
                                double px,
                                double py,
                                double vx,
                                double vy,
                                double r,
                                double m) {
  if (i < 0 || i >= capacity_) {
    return;
  }
  Particle& p = particles_[static_cast<std::size_t>(i)];
  p.pos_x = px;
  p.pos_y = py;
  p.vel_x = vx;
  p.vel_y = vy;
  p.radius = r;
  p.mass = m;
  p.last_update_time = 0;
  p.collision_count = 0;
  p.pad = 0;
}

void OracleEngine::bootstrap() {
  integrate_all(0);
  sim_time_ = 0;
  heap_.clear();
  zeno_micro_streak_ = 0;
  predict_all();
}

Vec2 OracleEngine::pos_at(int i, double t) const {
  const Particle& p = particles_[static_cast<std::size_t>(i)];
  const double dt = t - p.last_update_time;
  return {p.pos_x + p.vel_x * dt, p.pos_y + p.vel_y * dt};
}

void OracleEngine::integrate_all(double t) {
  for (int i = 0; i < n_active_; ++i) {
    Particle& p = particles_[static_cast<std::size_t>(i)];
    const Vec2 pt = pos_at(i, t);
    p.pos_x = pt.x;
    p.pos_y = pt.y;
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
  const Vec2 pa = pos_at(i, t0);
  const Vec2 pb = pos_at(j, t0);
  const Particle& a = particles_[static_cast<std::size_t>(i)];
  const Particle& b = particles_[static_cast<std::size_t>(j)];
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
  const Vec2 pos = pos_at(i, t0);
  const auto hit =
      earliest_wall_collision_time({pos.x, pos.y}, {p.vel_x, p.vel_y}, p.radius, bounds_, t0,
                                   t0 + kTimeEps);
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

void OracleEngine::predict_all() {
  for (int i = 0; i < n_active_; ++i) {
    predict_wall(i);
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
  switch (e.wall) {
    case WallAxis::Left:
    case WallAxis::Right:
      p.vel_x = -p.vel_x;
      break;
    case WallAxis::Top:
    case WallAxis::Bottom:
      p.vel_y = -p.vel_y;
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
  }
  p.collision_count++;
}

void OracleEngine::resolve_pair(const SimEvent& e) {
  Particle& a = particles_[static_cast<std::size_t>(e.a)];
  Particle& b = particles_[static_cast<std::size_t>(e.b)];
  resolve_elastic_pair(a, b, 1.0);
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
    // Absolute event time (not accumulated) — avoids float drift vs target collision time.
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
  // Heap root can be a ghost (stale counts). Next applied event is the earliest
  // in time among entries that still validate — same order as process_next_collision.
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

std::optional<Vec2> OracleEngine::peek_next_impact() const {
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
    const Vec2 p = pos_at(i, e.time);
    const Particle& pt = particles_[static_cast<std::size_t>(i)];
    switch (e.wall) {
      case WallAxis::Left:
        return Vec2{bounds_.minX, p.y};
      case WallAxis::Right:
        return Vec2{bounds_.maxX, p.y};
      case WallAxis::Top:
        return Vec2{p.x, bounds_.minY};
      case WallAxis::Bottom:
        return Vec2{p.x, bounds_.maxY};
    }
  }
  const int ia = e.a;
  const int ib = e.b;
  if (ia < 0 || ib < 0 || ia >= n_active_ || ib >= n_active_) {
    return std::nullopt;
  }
  const Vec2 pa = pos_at(ia, e.time);
  const Vec2 pb = pos_at(ib, e.time);
  const Vec2 n = normalize({pb.x - pa.x, pb.y - pa.y});
  const double ra = particles_[static_cast<std::size_t>(ia)].radius;
  return Vec2{pa.x + n.x * ra, pa.y + n.y * ra};
}

}  // namespace oracle
