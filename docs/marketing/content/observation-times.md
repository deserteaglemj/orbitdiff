# When did they follow that account?

OrbitDiff records when it first observed a changed relationship and when another observation confirmed it. It cannot tell you the exact time someone tapped Follow.

**Synthetic example:** pixel_forge first appears in atlas_studio's accepted complete observation on October 1 at 09:00 UTC. Another agrees on October 2 at 09:00 UTC. Those are first-observed and confirmed collection times, not action timestamps. The baseline was September 30.

The Follow action could have happened between earlier checks. Incomplete coverage or gaps further limit inference; do not translate these dates into a guaranteed action interval. UTC timestamps make the observation reference explicit. Displaying them in another timezone does not add precision.

If October 3's check is incomplete, October 2's evidence remains. That does not establish that no new follows occurred on October 3. A later event still needs agreeing accepted complete observations.

The [following guide](who-did-they-follow.md) explains the changed handle. [Agent history](agent-history.md) explains reports. **Try the offline demo with your agent** using the [setup prompt](../../prompt.md); no Instagram login is needed for the synthetic route. Actual live behavior remains a separate gate.
