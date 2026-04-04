#include "oracle/oracle_engine.hpp"

#include "oracle/collision_math.hpp"

#include <algorithm>
#include <cmath>

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
  p.collision_count++;
}

void OracleEngine::resolve_pair(const SimEvent& e) {
  Particle& a = particles_[static_cast<std::size_t>(e.a)];
  Particle& b = particles_[static_cast<std::size_t>(e.b)];
  const Vec2 pa = pos_at(e.a, sim_time_);
  const Vec2 pb = pos_at(e.b, sim_time_);
  const Vec2 n = normalize({pb.x - pa.x, pb.y - pa.y});
  resolve_elastic_pair(a, b, n, 1.0);
  a.collision_count++;
  b.collision_count++;
}

bool OracleEngine::process_next_collision() {
  while (!heap_.empty()) {
    SimEvent e = heap_.pop();
    if (!validate_event(e)) {
      continue;
    }
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
  return heap_.peek();
}

std::optional<double> OracleEngine::peek_next_time() const {
  const auto e = peek_next();
  if (!e.has_value()) {
    return std::nullopt;
  }
  return e->time;
}

}  // namespace oracle
