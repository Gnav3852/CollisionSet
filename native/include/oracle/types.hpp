#pragma once

#include <cstdint>

namespace oracle {

inline constexpr double kEps = 1e-10;
inline constexpr double kTimeEps = 1e-7;

struct Vec2 {
  double x = 0;
  double y = 0;
};

struct AxisBounds {
  double minX = 0;
  double maxX = 0;
  double minY = 0;
  double maxY = 0;
};

/** POD layout fixed for WASM/TS DataView (64 bytes per particle). */
struct alignas(8) Particle {
  double pos_x = 0;
  double pos_y = 0;
  double vel_x = 0;
  double vel_y = 0;
  double radius = 0;
  double mass = 1;
  double last_update_time = 0;
  std::int32_t collision_count = 0;
  std::int32_t pad = 0;
};

static_assert(sizeof(Particle) == 64, "Particle layout must match oracleWasm.ts");

enum class WallAxis : std::uint8_t { Left, Right, Top, Bottom };

enum class EventKind : std::uint8_t { Pair, Wall };

struct SimEvent {
  double time = 0;
  EventKind kind = EventKind::Pair;
  /** Pair: both indices. Wall: particle index in `a` only. */
  std::int32_t a = 0;
  std::int32_t b = 0;
  WallAxis wall = WallAxis::Left;
  std::int32_t count_a = 0;
  std::int32_t count_b = 0;
};

inline bool eventTimeLess(const SimEvent& x, const SimEvent& y) { return x.time < y.time; }

}  // namespace oracle
