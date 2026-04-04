#pragma once

#include "min_heap.hpp"
#include "types.hpp"

#include <optional>
#include <vector>

namespace oracle {

struct EventTimeKey {
  double operator()(const SimEvent& e) const { return e.time; }
};

using EventHeap = MinHeap<SimEvent, EventTimeKey>;

class OracleEngine {
 public:
  explicit OracleEngine(int max_particles, AxisBounds bounds);

  AxisBounds bounds() const { return bounds_; }

  int particle_count() const { return n_active_; }
  void set_particle_count(int n);
  void set_particle(int i, double px, double py, double vx, double vy, double r, double m);

  /** integrate all to t=0, sim_time=0, clear heap, predictAll */
  void bootstrap();

  double sim_time() const { return sim_time_; }

  const Particle* particles_data() const { return particles_.data(); }
  Particle* particles_data() { return particles_.data(); }
  int capacity() const { return capacity_; }

  bool heap_empty() const { return heap_.empty(); }
  std::size_t heap_size() const { return heap_.size(); }

  /** Earliest heap event that passes validate_event (ignores stale roots). */
  std::optional<SimEvent> peek_next() const;
  std::optional<double> peek_next_time() const;

  /** Drop heap entries strictly before sim time (stale ghosts); keeps e.time >= t_cut - kTimeEps. */
  void purge_events_before(double t_cut);

  /** Contact / impact point in world space for peek_next(), or nullopt if none. */
  std::optional<Vec2> peek_next_impact() const;

  std::vector<SimEvent> get_queued_sorted() const { return heap_.snapshot_sorted(); }

  int step_collisions(int max_steps);

 private:
  int capacity_ = 0;
  int n_active_ = 0;
  AxisBounds bounds_;
  double sim_time_ = 0;
  std::vector<Particle> particles_;
  EventHeap heap_;
  /** Consecutive sub-microsecond applied event steps (ORACLE_ZENO_DEBUG only). */
  int zeno_micro_streak_ = 0;

  Vec2 pos_at(int i, double t) const;

  void integrate_all(double t);
  bool validate_event(const SimEvent& e) const;
  void predict_pair(int i, int j);
  void predict_wall(int i);
  void predict_all();
  void repredict_involved(const std::vector<int>& indices);
  void resolve_wall(const SimEvent& e);
  void resolve_pair(const SimEvent& e);
  bool process_next_collision();
};

}  // namespace oracle
