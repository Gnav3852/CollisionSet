#pragma once

#include "types.hpp"

#include <optional>

namespace oracle {

/** Tiny outward separation after resolve to avoid zero-Δt re-hit from float error (pixel arena). */
inline constexpr double kPostCollisionSeparation = 1e-4;

std::optional<std::pair<double, WallAxis>> earliest_wall_collision_time(
    Vec2 p,
    Vec2 v,
    double r,
    const VolumeBounds& b,
    double t_ref,
    double t_min);

/** Full axis-aligned box (six faces, sphere rim). */
std::optional<std::pair<double, WallAxis>> earliest_wall_collision_time_3d(
    Vec3 p,
    Vec3 v,
    double r,
    const VolumeBounds& b,
    double t_ref,
    double t_min);

/**
 * Torus-mode edge crossing: predicts when the particle *center* (not rim) passes
 * an arena edge. Used instead of wall collision for periodic boundaries — the
 * axis field of the returned pair tags which edge, so resolve_wall can teleport
 * to the opposite side.
 */
std::optional<std::pair<double, WallAxis>> earliest_wrap_crossing_time(
    Vec2 p,
    Vec2 v,
    const VolumeBounds& b,
    double t_ref,
    double t_min);

/**
 * Smallest dt >= kMinPairDt with t_ref + dt > t_min such that 0.5*acc*dt² + v*dt + c = 0.
 * Used for wall/divider scheduling under uniform acceleration.
 */
std::optional<double> earliest_uniform_accel_axis_hit_dt(
    double acc,
    double v,
    double c,
    double t_ref,
    double t_min);

/** Same as `earliest_wall_collision_time` but with constant acceleration (px/s²). */
std::optional<std::pair<double, WallAxis>> earliest_wall_collision_time_2d_uniform_accel(
    Vec2 p,
    Vec2 v,
    Vec2 a,
    double r,
    const VolumeBounds& b,
    double t_ref,
    double t_min);

/** Same as `earliest_wall_collision_time_3d` but with constant acceleration. */
std::optional<std::pair<double, WallAxis>> earliest_wall_collision_time_3d_uniform_accel(
    Vec3 p,
    Vec3 v,
    Vec3 a,
    double r,
    const VolumeBounds& b,
    double t_ref,
    double t_min);

/** Torus center crossing with uniform acceleration (per-axis quadratics). */
std::optional<std::pair<double, WallAxis>> earliest_wrap_crossing_time_2d_uniform_accel(
    Vec2 p,
    Vec2 v,
    Vec2 a,
    const VolumeBounds& b,
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

std::optional<double> earliest_pair_collision_time_3d(Vec3 p1,
                                                       Vec3 v1,
                                                       double r1,
                                                       Vec3 p2,
                                                       Vec3 v2,
                                                       double r2,
                                                       double t_ref,
                                                       double t_min);

Vec2 normalize(Vec2 v);

/** Elastic impulse from positions/velocities; applies half `kPostCollisionSeparation` nudge along line of centers. */
void resolve_elastic_pair(Particle& a, Particle& b, double restitution = 1.0);

/** 3D elastic pair resolve along line of centers in R^3. */
void resolve_elastic_pair_3d(Particle& a, Particle& b, double restitution = 1.0);

}  // namespace oracle
