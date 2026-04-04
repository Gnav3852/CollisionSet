#pragma once

#include "types.hpp"

#include <optional>

namespace oracle {

std::optional<std::pair<double, WallAxis>> earliest_wall_collision_time(
    Vec2 p,
    Vec2 v,
    double r,
    const AxisBounds& b,
    double t_ref,
    double t_min);

/** Absolute collision time T, or nullopt if none in future. */
std::optional<double> earliest_pair_collision_time(Vec2 p1,
                                                     Vec2 v1,
                                                     double r1,
                                                     Vec2 p2,
                                                     Vec2 v2,
                                                     double r2,
                                                     double t_ref,
                                                     double t_min);

Vec2 normalize(Vec2 v);

void resolve_elastic_pair(Particle& a, Particle& b, Vec2 n, double restitution = 1.0);

}  // namespace oracle
