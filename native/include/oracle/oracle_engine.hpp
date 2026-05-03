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
  explicit OracleEngine(int max_particles, VolumeBounds bounds);

  VolumeBounds bounds() const { return bounds_; }
  SpaceMode space_mode() const { return space_mode_; }
  void set_space_mode(SpaceMode m);

  int particle_count() const { return n_active_; }
  void set_particle_count(int n);
  void set_particle(int i,
                     double px,
                     double py,
                     double pz,
                     double vx,
                     double vy,
                     double vz,
                     double r,
                     double m);

  double restitution() const { return restitution_; }
  void set_restitution(double e);

  /** Uniform gravity / acceleration in world px/s² (XY uses x,y; z ignored for integration in XY). */
  Vec3 gravity() const { return gravity_; }
  void set_gravity(double ax, double ay, double az);

  /** Periodic boundaries (XY only; no-op in SpaceMode::XYZ). */
  bool torus_mode() const { return torus_mode_; }
  void set_torus_mode(bool on);

  /**
   * Maxwell-style divider (XY only; no-op in SpaceMode::XYZ).
   */
  bool divider_active() const { return divider_active_; }
  bool door_open() const { return door_open_; }
  double divider_x() const { return divider_x_; }
  double gap_top() const { return gap_top_; }
  double gap_bot() const { return gap_bot_; }
  void set_divider_active(bool on);
  void set_door_open(bool open);
  void set_divider_geometry(double xs, double gap_top_y, double gap_bot_y);

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
  std::optional<Vec3> peek_next_impact() const;

  std::vector<SimEvent> get_queued_sorted() const { return heap_.snapshot_sorted(); }

  int step_collisions(int max_steps);

 private:
  int capacity_ = 0;
  int n_active_ = 0;
  VolumeBounds bounds_{};
  SpaceMode space_mode_ = SpaceMode::XY;
  double sim_time_ = 0;
  double restitution_ = 1.0;
  bool torus_mode_ = false;
  bool divider_active_ = false;
  bool door_open_ = false;
  double divider_x_ = 0;
  double gap_top_ = 0;
  double gap_bot_ = 0;
  Vec3 gravity_{0, 0, 0};
  std::vector<Particle> particles_;
  EventHeap heap_;
  /** Consecutive sub-microsecond applied event steps (ORACLE_ZENO_DEBUG only). */
  int zeno_micro_streak_ = 0;

  Vec3 pos_at(int i, double t) const;
  double z_mid() const { return 0.5 * (bounds_.minZ + bounds_.maxZ); }

  void integrate_all(double t);
  bool validate_event(const SimEvent& e) const;
  void predict_pair(int i, int j);
  void predict_wall(int i);
  void predict_divider(int i);
  /** Invalidate all queued events (via collision_count++) and re-predict from current state. */
  void invalidate_and_repredict_all();
  void predict_all();
  void repredict_involved(const std::vector<int>& indices);
  void resolve_wall(const SimEvent& e);
  void resolve_pair(const SimEvent& e);
  bool process_next_collision();
};

}  // namespace oracle
