<template>
  <control-wrapper
    v-bind="controlWrapper"
    :styles="styles"
    :is-focused="isFocused"
    :applied-options="appliedOptions"
  >
    <select
      :id="control.id + '-input'"
      :class="styles.control.select"
      :value="control.data"
      :disabled="!control.enabled"
      :autofocus="appliedOptions.focus"
      @change="onChange"
      @focus="isFocused = true"
      @blur="isFocused = false"
    >
      <option key="empty" value="" :class="styles.control.option" />
      <option
        v-for="optionElement in control.options"
        :key="String(optionElement.value)"
        :value="optionElement.value"
        :label="optionElement.label"
        :class="styles.control.option"
      ></option>
    </select>
  </control-wrapper>
</template>

<script lang="ts">
import type { ControlElement } from '@jsonforms/core';
import { defineComponent } from 'vue';
import { rendererProps, useJsonFormsEnumControl } from '@jsonforms/vue';
import type { RendererProps } from '@jsonforms/vue';
import { ControlWrapper, useVanillaControl } from '@jsonforms/vue-vanilla';

/**
 * Vanilla's EnumControlRenderer emits the <select>'s DOM string on change, so
 * an integer schema like { type: 'integer', enum: [1, 2, 3, 4] } hands the form
 * "2" and schema validation rejects it ("must be integer"). Identical to
 * upstream except the chosen string is mapped back to the original enum
 * member, keeping numbers numbers and booleans booleans.
 */
const controlRenderer = defineComponent({
  name: 'TypedEnumControlRenderer',
  components: {
    ControlWrapper,
  },
  props: {
    ...rendererProps<ControlElement>(),
  },
  setup(props: RendererProps<ControlElement>) {
    const enumControl = useJsonFormsEnumControl(props);
    const { control } = enumControl;
    return useVanillaControl(enumControl, (target: HTMLSelectElement) => {
      if (target.selectedIndex === 0) return undefined;
      const chosen = control.value.options?.find(
        (o) => String(o.value) === target.value,
      );
      return chosen ? chosen.value : target.value;
    });
  },
});

export default controlRenderer;
</script>
