#include "oracle/oracle_engine.hpp"

#include <algorithm>
#include <cstdint>
#include <cstdlib>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define ORACLE_API EMSCRIPTEN_KEEPALIVE
#else
#define ORACLE_API
#endif

using oracle::AxisBounds;
using oracle::EventKind;
using oracle::OracleEngine;
using oracle::WallAxis;

extern "C" {

ORACLE_API
void* oracle_create(int max_n, double minX, double maxX, double minY, double maxY) {
  if (max_n <= 0) {
    return nullptr;
  }
  const AxisBounds b{minX, maxX, minY, maxY};
  return new OracleEngine(max_n, b);
}

ORACLE_API
void oracle_destroy(void* ctx) {
  delete static_cast<OracleEngine*>(ctx);
}

ORACLE_API
void oracle_set_particle_count(void* ctx, int n) {
  if (!ctx) {
    return;
  }
  static_cast<OracleEngine*>(ctx)->set_particle_count(n);
}

ORACLE_API
void oracle_set_particle(void* ctx,
                           int i,
                           double px,
                           double py,
                           double vx,
                           double vy,
                           double r,
                           double m) {
  if (!ctx) {
    return;
  }
  static_cast<OracleEngine*>(ctx)->set_particle(i, px, py, vx, vy, r, m);
}

ORACLE_API
void oracle_bootstrap(void* ctx) {
  if (!ctx) {
    return;
  }
  static_cast<OracleEngine*>(ctx)->bootstrap();
}

ORACLE_API
double oracle_get_sim_time(void* ctx) {
  if (!ctx) {
    return 0;
  }
  return static_cast<OracleEngine*>(ctx)->sim_time();
}

ORACLE_API
int oracle_get_particle_count(void* ctx) {
  if (!ctx) {
    return 0;
  }
  return static_cast<OracleEngine*>(ctx)->particle_count();
}

ORACLE_API
int oracle_get_capacity(void* ctx) {
  if (!ctx) {
    return 0;
  }
  return static_cast<OracleEngine*>(ctx)->capacity();
}

ORACLE_API
uintptr_t oracle_particles_ptr(void* ctx) {
  if (!ctx) {
    return 0;
  }
  const auto* p = static_cast<OracleEngine*>(ctx)->particles_data();
  return reinterpret_cast<uintptr_t>(p);
}

ORACLE_API
int oracle_step(void* ctx, int max_steps) {
  if (!ctx) {
    return 0;
  }
  return static_cast<OracleEngine*>(ctx)->step_collisions(max_steps);
}

ORACLE_API
int oracle_heap_size(void* ctx) {
  if (!ctx) {
    return 0;
  }
  return static_cast<int>(static_cast<OracleEngine*>(ctx)->heap_size());
}

ORACLE_API
int oracle_peek_valid(void* ctx) {
  if (!ctx) {
    return 0;
  }
  return static_cast<OracleEngine*>(ctx)->heap_empty() ? 0 : 1;
}

ORACLE_API
double oracle_peek_time(void* ctx) {
  if (!ctx) {
    return 0;
  }
  const auto t = static_cast<OracleEngine*>(ctx)->peek_next_time();
  return t.has_value() ? *t : 0;
}

ORACLE_API
int oracle_peek_kind(void* ctx) {
  if (!ctx) {
    return -1;
  }
  const auto e = static_cast<OracleEngine*>(ctx)->peek_next();
  if (!e.has_value()) {
    return -1;
  }
  return e->kind == EventKind::Pair ? 0 : 1;
}

ORACLE_API
int oracle_peek_a(void* ctx) {
  if (!ctx) {
    return -1;
  }
  const auto e = static_cast<OracleEngine*>(ctx)->peek_next();
  return e.has_value() ? static_cast<int>(e->a) : -1;
}

ORACLE_API
int oracle_peek_b(void* ctx) {
  if (!ctx) {
    return -1;
  }
  const auto e = static_cast<OracleEngine*>(ctx)->peek_next();
  return e.has_value() ? static_cast<int>(e->b) : -1;
}

ORACLE_API
int oracle_peek_wall(void* ctx) {
  if (!ctx) {
    return -1;
  }
  const auto e = static_cast<OracleEngine*>(ctx)->peek_next();
  if (!e.has_value()) {
    return -1;
  }
  return static_cast<int>(e->wall);
}

ORACLE_API
int oracle_peek_count_a(void* ctx) {
  if (!ctx) {
    return -1;
  }
  const auto e = static_cast<OracleEngine*>(ctx)->peek_next();
  return e.has_value() ? e->count_a : -1;
}

ORACLE_API
int oracle_peek_count_b(void* ctx) {
  if (!ctx) {
    return -1;
  }
  const auto e = static_cast<OracleEngine*>(ctx)->peek_next();
  return e.has_value() ? e->count_b : -1;
}

/**
 * Export sorted heap rows into parallel arrays (JS malloc'd wasm memory).
 * kind: 0 pair, 1 wall. wall: 0 L, 1 R, 2 T, 3 B (pair rows use 0).
 * Returns number of rows written (<= max_rows).
 */
ORACLE_API
int oracle_heap_export(void* ctx,
                       double* times,
                       std::int32_t* kinds,
                       std::int32_t* ia,
                       std::int32_t* ib,
                       std::int32_t* walls,
                       std::int32_t* ca,
                       std::int32_t* cb,
                       int max_rows) {
  if (!ctx || !times || !kinds || !ia || !ib || !walls || !ca || !cb || max_rows <= 0) {
    return 0;
  }
  auto* o = static_cast<OracleEngine*>(ctx);
  const auto sorted = o->get_queued_sorted();
  const int n = static_cast<int>(
      std::min(sorted.size(), static_cast<std::size_t>(max_rows)));
  for (int i = 0; i < n; ++i) {
    const auto& e = sorted[static_cast<std::size_t>(i)];
    times[i] = e.time;
    kinds[i] = e.kind == EventKind::Pair ? 0 : 1;
    ia[i] = e.a;
    ib[i] = e.b;
    walls[i] = static_cast<std::int32_t>(e.wall);
    ca[i] = e.count_a;
    cb[i] = e.count_b;
  }
  return n;
}

}  // extern "C"
